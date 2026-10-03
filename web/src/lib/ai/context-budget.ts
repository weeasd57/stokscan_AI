export class EvidenceContextOverflow extends Error {
    constructor(public requiredChars: number, public budgetChars: number) {
        super(`Verified context requires ${requiredChars} characters; budget is ${budgetChars}`);
        this.name = "EvidenceContextOverflow";
    }
}

/** A heading and its following facts form ONE block. Keeping a heading alone
 * must never be mistaken for preserving the data that it describes. */
export function assembleContextSafely(sections: string[], maxChars: number): string {
    const blocks: string[] = [];
    for (const section of sections) {
        if (/^(?:===|⚠️ SYSTEM CORRECTION ALERT)/.test(section) || !blocks.length) blocks.push(section);
        else blocks[blocks.length - 1] += `\n\n${section}`;
    }
    const protectedBlock = (block: string) => /^=== (?:PUBLICATION EVIDENCE CONTRACT|LIVE DATA|HISTORICAL DATA|DATABASE DATA|USER REQUEST|OWNED POSITION CONTEXT|ALLOWED SYMBOLS|STRICT EVIDENCE CONTEXT \(FACTS, DERIVED & AVAILABLE EVIDENCE\)|EVIDENCE ENGINE|RESOLVED REFERENCE|IMAGE ANALYSIS|FOLLOW-UP QUESTION)/.test(block)
        || block.startsWith("⚠️ SYSTEM CORRECTION ALERT");
    if (blocks.join("\n\n").length <= maxChars) return blocks.join("\n\n");
    const required = blocks.filter(protectedBlock);
    const requiredText = required.join("\n\n");
    if (requiredText.length > maxChars) throw new EvidenceContextOverflow(requiredText.length, maxChars);
    // Discard optional whole blocks; never cut a fact, URL, row or instruction
    // halfway and leave the model to complete an incomplete sentence.
    let remaining = maxChars - requiredText.length;
    const retained = new Set(required);
    for (const block of blocks.filter(block => !protectedBlock(block))) {
        if (block.length + 2 <= remaining) { retained.add(block); remaining -= block.length + 2; }
    }
    return blocks.filter(block => retained.has(block)).join("\n\n");
}
