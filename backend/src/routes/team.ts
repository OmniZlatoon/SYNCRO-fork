import { Router, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/database";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { emailService } from "../services/email-service";
import { createTeamInviteLimiter } from "../middleware/rate-limit-factory";
import logger from "../config/logger";

const router = Router();

router.use(authenticate);

// ─── Validation ─────────────────────────────────────────────────────────

const VALID_ROLES = ["admin", "member", "viewer"] as const;

const inviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(VALID_ROLES).default("member"),
});

const updateRoleSchema = z.object({
  role: z.enum(VALID_ROLES),
});

// ─── Helpers ────────────────────────────────────────────────────────────

async function resolveUserTeam(userId: string) {
  const { data: ownedTeam } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", userId)
    .single();

  if (ownedTeam) {
    return { teamId: ownedTeam.id, isOwner: true, memberRole: null };
  }

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)
    .single();

  if (membership) {
    return {
      teamId: membership.team_id,
      isOwner: false,
      memberRole: membership.role,
    };
  }

  return null;
}

function canManageTeam(ctx: any) {
  return ctx.isOwner || ctx.memberRole === "admin";
}

// ─── GET team members ───────────────────────────────────────────────────

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await resolveUserTeam(req.user!.id);
    if (!ctx) return res.json({ success: true, data: [] });

    const { data: members } = await supabase
      .from("team_members")
      .select("id, user_id, role, joined_at")
      .eq("team_id", ctx.teamId);

    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        const { data } = await supabase.auth.admin.getUserById(m.user_id);
        return {
          id: m.id,
          userId: m.user_id,
          email: data?.user?.email ?? null,
          role: m.role,
          joinedAt: m.joined_at,
        };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error("GET team error:", error);
    res.status(500).json({ success: false });
  }
});

// ─── INVITE ─────────────────────────────────────────────────────────────

router.post(
  "/invite",
  createTeamInviteLimiter(),
  requireRole("owner", "admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(", "),
        });
      }

      const { email, role } = parsed.data;

      let ctx = await resolveUserTeam(req.user!.id);

      if (!ctx) {
        const { data: newTeam } = await supabase
          .from("teams")
          .insert({
            name: `${req.user!.email}'s Team`,
            owner_id: req.user!.id,
          })
          .select("id")
          .single();

        ctx = { teamId: newTeam!.id, isOwner: true, memberRole: null };
      }

      if (!canManageTeam(ctx)) {
        return res.status(403).json({ success: false });
      }

      const { data: existing } = await supabase
        .from("team_invitations")
        .select("id")
        .eq("team_id", ctx.teamId)
        .eq("email", email)
        .is("accepted_at", null)
        .single();

      if (existing) {
        return res.status(409).json({ success: false });
      }

      // find user via listUsers (correct approach)
      const { data } = await supabase.auth.admin.listUsers();
      const user = data.users.find((u) => u.email === email);

      if (user) {
        const { data: alreadyMember } = await supabase
          .from("team_members")
          .select("id")
          .eq("team_id", ctx.teamId)
          .eq("user_id", user.id)
          .single();

        if (alreadyMember) {
          return res.status(409).json({ success: false });
        }
      }

      const { data: invitation } = await supabase
        .from("team_invitations")
        .insert({
          team_id: ctx.teamId,
          email,
          role,
          invited_by: req.user!.id,
        })
        .select("id, token")
        .single();

      const acceptUrl = `${process.env.FRONTEND_URL}/team/accept/${invitation!.token}`;

      emailService.sendInvitationEmail(email, {
        inviterEmail: req.user!.email,
        teamName: "Team",
        role,
        acceptUrl,
        expiresAt: new Date(),
      });

      res.status(201).json({ success: true });
    } catch (error) {
      logger.error("Invite error:", error);
      res.status(500).json({ success: false });
    }
  }
);

// ─── ACCEPT ─────────────────────────────────────────────────────────────

router.post("/accept/:token", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params;

    const { data: invitation } = await supabase
      .from("team_invitations")
      .select("*")
      .eq("token", token)
      .single();

    if (!invitation) {
      return res.status(404).json({ success: false });
    }

    if (req.user!.email !== invitation.email) {
      return res.status(403).json({ success: false });
    }

    await supabase.from("team_members").insert({
      team_id: invitation.team_id,
      user_id: req.user!.id,
      role: invitation.role,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Accept error:", error);
    res.status(500).json({ success: false });
  }
});

// ─── UPDATE ROLE ────────────────────────────────────────────────────────

router.put(
  "/:memberId/role",
  requireRole("owner"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false });
      }

      const { memberId } = req.params;

      const { data } = await supabase
        .from("team_members")
        .update({ role: parsed.data.role })
        .eq("id", memberId)
        .select()
        .single();

      res.json({ success: true, data });
    } catch (error) {
      logger.error("Role update error:", error);
      res.status(500).json({ success: false });
    }
  }
);

// ─── DELETE MEMBER ──────────────────────────────────────────────────────

router.delete(
  "/:memberId",
  requireRole("owner", "admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await supabase.from("team_members").delete().eq("id", req.params.memberId);
      res.json({ success: true });
    } catch (error) {
      logger.error("Delete member error:", error);
      res.status(500).json({ success: false });
    }
  }
);

export default router;