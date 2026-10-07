/** Snapshot → what the director reads: props intact, data trimmed. Shared
 *  by the MCP server (scene_get) and the stage manager (inline in nudges). */
export function describeScene(snapshot) {
  const cards = (snapshot.cards ?? []).map((c) => {
    const d = c.data;
    let data;
    if (d && typeof d === 'object') {
      data = {
        ok: d.ok,
        ...(d.value != null ? { value: d.value } : {}),
        ...(d.active ? { active: d.active, sub: d.sub, uptimeSec: d.uptimeSec, restarts: d.restarts } : {}),
        ...(d.kv ? { kv: d.kv.slice(0, 8) } : {}),
        ...(d.out && !d.kv && d.value == null && !d.active ? { out: String(d.out).slice(0, 300) } : {}),
        ...(d.err ? { err: String(d.err).slice(0, 200) } : {}),
        ...(d.at ? { ageSec: Math.round((Date.now() - d.at) / 1000) } : {}),
      };
    }
    return {
      id: c.id,
      plugin: c.plugin,
      title: c.title,
      props: c.props,
      ...(data ? { data } : {}),
      ...(c.lastAction ? { lastAction: c.lastAction } : {}),
    };
  });
  return JSON.stringify({ scope: snapshot.scope, rev: snapshot.rev, cards }, null, 1);
}
