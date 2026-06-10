export type ModelCard = {
  name?: string;
  model_name?: string;
  exchange?: string;
  size_mb?: number;
  [key: string]: unknown;
};

/** Keep only the two canonical EGX models: KING + THE BRAIN (NANO). */
export function selectCanonicalModelCards(models: ModelCard[]): ModelCard[] {
  const list = models || [];

  const kingPool = list.filter((m) => {
    const n = (m.name || m.model_name || "").toUpperCase();
    if (!n.includes("KING")) return false;
    if (n.includes("COUNCIL") || n.includes("VALIDATOR") || n.includes("ADVISOR")) return false;
    // Skip auto-generated training dumps like KINGF091491.pkl when canonical KING exists
    if (/^KINGF\d/i.test(n.replace(/\s/g, ""))) return false;
    return true;
  });

  const brainPool = list.filter((m) => {
    const n = (m.name || m.model_name || "").toUpperCase();
    if (n.includes("BRAIN")) return true;
    if (n.includes("NANO") || n.includes("NEW_MODEL")) return true;
    return false;
  });

  const pickOne = (pool: ModelCard[], preferred: string[]): ModelCard | null => {
    if (pool.length === 0) return null;
    for (const pref of preferred) {
      const hit = pool.find((m) => {
        const name = m.name || m.model_name || "";
        return name === pref || name.includes(pref);
      });
      if (hit) return hit;
    }
    return pool.sort((a, b) => {
      const score = (m: ModelCard) => {
        const name = (m.name || m.model_name || "").toUpperCase();
        let s = 0;
        if ((m.size_mb as number) > 0) s += 10;
        if (name === "KING 👑.PKL" || name === "KING.PKL") s += 20;
        if (name.includes("THE BRAIN")) s += 20;
        return s - name.length * 0.01;
      };
      return score(b) - score(a);
    })[0];
  };

  const picked: ModelCard[] = [];
  const king = pickOne(kingPool, ["KING 👑.pkl", "KING.pkl"]);
  const brain = pickOne(brainPool, ["THE BRAIN.pkl", "NANO"]);
  if (king) picked.push(king);
  if (brain) picked.push(brain);
  return picked;
}
