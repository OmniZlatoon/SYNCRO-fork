import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import SecuritySettingsPanel from "@/components/security/SecuritySettingsPanel"

// Feature: two-factor-authentication

export default async function SecuritySettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  // Fetch MFA factors, profile, and team data in parallel
  const [
    { data: factorsData },
    { data: profile },
    { data: ownedTeam },
    { data: memberTeam },
  ] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.from("profiles").select("two_fa_enabled_at").eq("id", user.id).single(),
    // Check if user owns a team
    supabase.from("teams").select("id, require_2fa").eq("owner_id", user.id).maybeSingle(),
    // Check if user is a member of a team (to get that team's enforcement status)
    supabase
      .from("team_members")
      .select("team_id, teams!inner(id, require_2fa, owner_id)")
      .eq("user_id", user.id)
      .maybeSingle(),
  ])

  // Resolve enrolled TOTP factor (first active totp factor)
  const totpFactors = factorsData?.totp ?? []
  const enrolledFactor = totpFactors.find((f) => f.status === "verified") ?? null

  const twoFaEnabledAt = profile?.two_fa_enabled_at ?? null
  const twoFaEnabled = enrolledFactor !== null

  // Determine team context — prefer owned team, fall back to member team
  let teamId: string | null = null
  let teamRequires2fa = false
  let isTeamOwner = false

  if (ownedTeam) {
    teamId = ownedTeam.id
    teamRequires2fa = ownedTeam.require_2fa ?? false
    isTeamOwner = true
  } else if (memberTeam) {
    const team = Array.isArray(memberTeam.teams) ? memberTeam.teams[0] : memberTeam.teams
    if (team) {
      teamId = (team as { id: string; require_2fa: boolean; owner_id: string }).id
      teamRequires2fa = (team as { id: string; require_2fa: boolean; owner_id: string }).require_2fa ?? false
      isTeamOwner = false
    }
  }

  return (
    <SecuritySettingsPanel
      twoFaEnabled={twoFaEnabled}
      twoFaEnabledAt={twoFaEnabledAt}
      factorId={enrolledFactor?.id ?? null}
      isTeamOwner={isTeamOwner}
      teamId={teamId}
      teamRequires2fa={teamRequires2fa}
    />
  )
}
