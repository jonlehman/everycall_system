// Serialize account mutations so independent demotions cannot remove the last admin.
export async function lockPlatformUserMutations(client) {
  await client.query('SELECT pg_advisory_xact_lock(200704, 1)');
}

export function platformUserError(status, error) {
  return Object.assign(new Error(error), { status, publicError: error });
}
