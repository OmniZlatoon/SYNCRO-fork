import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { emailService } from '../services/email-service';
import { createTeamInviteLimiter } from '../middleware/rate-limit-factory';
import logger from '../config/logger';
import { validateRequest } from '../utils/validation';
import { NotFoundError, ForbiddenError, ConflictError, BadRequestError } from '../errors';

const router = Router();
router.use(authenticate);

// ─── Validation schemas ───────────────────────────────────────────────────────

const VALID_ROLES = ['admin', 'member', 'viewer'] as const;

const inviteSchema = z.object({
  email: z
    .string()
    .email('Must be a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: `role must be one of: ${VALID_ROLES.join(', ')}` }),
  }).default('member'),
});

const updateRoleSchema = z.object({
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: `role must be one of: ${VALID_ROLES.join(', ')}` }),
  }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the team associated with a user (owned or member).
 */
async function resolveUserTeam(userId: string) {
  // Check ownership
  const { data: ownedTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();

  if (ownedTeam) {
    return { teamId: ownedTeam.id, isOwner: true, memberRole: null };
  }

  // Check membership
  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (membership) {
    return { teamId: membership.team_id, isOwner: false, memberRole: membership.role };
  }

  return null;
}

function canManageTeam(ctx: { isOwner: boolean; memberRole: string | null }): boolean {
  return ctx.isOwner || ctx.memberRole === 'admin';
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/team
 * List team members
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await resolveUserTeam(req.user!.id);
  if (!ctx) {
    return res.json({ success: true, data: [] });
  }

  const { data: members, error } = await supabase
    .from('team_members')
    .select('id, user_id, role, joined_at')
    .eq('team_id', ctx.teamId)
    .order('joined_at', { ascending: true });

  if (error) throw error;

  const enriched = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data: userData } = await supabase.auth.admin.getUserById(m.user_id);
      return {
        id: m.id,
        userId: m.user_id,
        email: userData?.user?.email ?? null,
        role: m.role,
        joinedAt: m.joined_at,
      };
    })
  );

  res.json({ success: true, data: enriched });
});

/**
 * POST /api/team/invite
 */
router.post('/invite', createTeamInviteLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  const { email, role } = validateRequest(inviteSchema, req.body);

  let ctx = await resolveUserTeam(req.user!.id);

  if (!ctx) {
    // Auto-create a team for first-time owners
    const { data: newTeam, error: createErr } = await supabase
      .from('teams')
      .insert({ name: `${req.user!.email}'s Team`, owner_id: req.user!.id })
      .select('id')
      .single();

    if (createErr || !newTeam) throw createErr || new Error('Failed to create team');
    ctx = { teamId: newTeam.id, isOwner: true, memberRole: null };
  }

  if (!canManageTeam(ctx)) {
    throw new ForbiddenError('Only team owners and admins can invite members');
  }

  // Check for an existing active invitation
  const { data: existing } = await supabase
    .from('team_invitations')
    .select('id')
    .eq('team_id', ctx.teamId)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) {
    throw new ConflictError('A pending invitation already exists for this email');
  }

  // Check if already a member
  // Note: This requires admin lookup which might be restricted or slow
  const { data: userLookup } = await (supabase.auth.admin as any).getUserByEmail?.(email) || { data: { user: null } };
  if (userLookup?.user) {
    const { data: alreadyMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', ctx.teamId)
      .eq('user_id', userLookup.user.id)
      .maybeSingle();

    if (alreadyMember) {
      throw new ConflictError('This user is already a team member');
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const { data: invitation, error: invErr } = await supabase
    .from('team_invitations')
    .insert({
      team_id: ctx.teamId,
      email,
      role,
      invited_by: req.user!.id,
      expires_at: expiresAt.toISOString(),
    })
    .select('id, token, expires_at')
    .single();

  if (invErr || !invitation) throw invErr || new Error('Failed to create invitation');

  const { data: team } = await supabase
    .from('teams')
    .select('name')
    .eq('id', ctx.teamId)
    .single();

  const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/team/accept/${invitation.token}`;

  emailService
    .sendInvitationEmail(email, {
      inviterEmail: req.user!.email,
      teamName: team?.name ?? 'your team',
      role,
      acceptUrl,
      expiresAt,
    })
    .catch((err) => logger.error('Invitation email failed:', err));

  res.status(201).json({
    success: true,
    data: {
      id: invitation.id,
      email,
      role,
      expiresAt: invitation.expires_at,
      acceptUrl,
    },
  });
});

/**
 * GET /api/team/pending
 */
router.get('/pending', async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await resolveUserTeam(req.user!.id);
  if (!ctx || !canManageTeam(ctx)) {
    throw new ForbiddenError('Only team owners and admins can view pending invitations');
  }

  const { data: invitations, error } = await supabase
    .from('team_invitations')
    .select('id, email, role, expires_at, created_at, invited_by')
    .eq('team_id', ctx.teamId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;

  res.json({ success: true, data: invitations ?? [] });
});

/**
 * POST /api/team/accept/:token
 */
router.post('/accept/:token', async (req: AuthenticatedRequest, res: Response) => {
  const { token } = req.params;

  const { data: invitation, error: fetchErr } = await supabase
    .from('team_invitations')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .maybeSingle();

  if (fetchErr || !invitation) {
    throw new NotFoundError('Invitation not found or already used');
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new BadRequestError('Invitation has expired'); // Or perhaps a custom 410 if desired, but 400/404 is cleaner
  }

  if (req.user!.email !== invitation.email) {
    throw new ForbiddenError('This invitation was sent to a different email address');
  }

  const { data: existing } = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', invitation.team_id)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('team_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    return res.json({ success: true, message: 'You are already a member of this team' });
  }

  const { error: memberErr } = await supabase
    .from('team_members')
    .insert({ team_id: invitation.team_id, user_id: req.user!.id, role: invitation.role });

  if (memberErr) throw memberErr;

  await supabase
    .from('team_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  res.json({ success: true, message: 'You have joined the team', data: { role: invitation.role } });
});

/**
 * PUT /api/team/:memberId/role
 */
router.put('/:memberId/role', async (req: AuthenticatedRequest, res: Response) => {
  const { role } = validateRequest(updateRoleSchema, req.body);
  const ctx = await resolveUserTeam(req.user!.id);

  if (!ctx?.isOwner) {
    throw new ForbiddenError('Only the team owner can change member roles');
  }

  const { data: member, error: fetchErr } = await supabase
    .from('team_members')
    .select('id, user_id')
    .eq('id', req.params.memberId)
    .eq('team_id', ctx.teamId)
    .maybeSingle();

  if (fetchErr || !member) {
    throw new NotFoundError('Team member not found');
  }

  const { data: updated, error: updateErr } = await supabase
    .from('team_members')
    .update({ role })
    .eq('id', req.params.memberId)
    .select('id, user_id, role, joined_at')
    .single();

  if (updateErr) throw updateErr;

  res.json({ success: true, data: updated });
});

/**
 * DELETE /api/team/:memberId
 */
router.delete('/:memberId', async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await resolveUserTeam(req.user!.id);
  if (!ctx || !canManageTeam(ctx)) {
    throw new ForbiddenError('Only team owners and admins can remove members');
  }

  const { data: member, error: fetchErr } = await supabase
    .from('team_members')
    .select('id, user_id')
    .eq('id', req.params.memberId)
    .eq('team_id', ctx.teamId)
    .maybeSingle();

  if (fetchErr || !member) {
    throw new NotFoundError('Team member not found');
  }

  const { data: team } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', ctx.teamId)
    .single();

  if (team?.owner_id === member.user_id) {
    throw new BadRequestError('Cannot remove the team owner');
  }

  const { error: deleteErr } = await supabase
    .from('team_members')
    .delete()
    .eq('id', req.params.memberId);

  if (deleteErr) throw deleteErr;

  res.json({ success: true, message: 'Team member removed' });
});

export default router;
