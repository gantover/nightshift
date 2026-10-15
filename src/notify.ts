/** Push a message to ntfy (self-hosted on the Rock 5, or ntfy.sh). Runs on the host. */
export async function notify(url: string | null | undefined, title: string, body: string, priority = 3) {
  if (!url) return;
  try {
    await fetch(url, { method: "POST", body, headers: { Title: title, Priority: String(priority) } });
  } catch (e) {
    console.error(`ntfy failed: ${(e as Error).message}`);
  }
}
