import { supabase } from "@/lib/supabase";

/**
 * Every visitor gets a private, anonymous account the first time they open the app
 * (no login screen). All data is tied to that account, so each device runs a fully
 * closed session: nothing changed on one device ever appears on another.
 * The account lives in this browser — clearing site data starts a fresh workspace.
 */
export async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function bootstrapSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      throw new Error(
        `Could not start a private session (${error.message}). In Supabase, turn on Authentication → Sign In / Providers → "Allow anonymous sign-ins".`
      );
    }
  }
  const { error: workspaceError } = await supabase.rpc("ensure_workspace");
  if (workspaceError) {
    throw new Error(
      `Could not prepare your workspace (${workspaceError.message}). Has supabase/private_workspaces.sql been run?`
    );
  }
}
