import { runPipeline } from "./src/lib/ai/pipeline";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load env variables
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, "utf8");
    env.split("\n").forEach(line => {
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (match) {
            let val = match[2].trim();
            if (val.startsWith("'") || val.startsWith('"')) val = val.slice(1, -1);
            process.env[match[1]] = val;
        }
    });
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function test() {
    const state = { current_symbol: null, last_symbols: [], summary: null };
    const history = [];
    
    // Get valid uuid from DB or generate a valid v4 uuid
    const sessionUuid = "a471f6c8-7313-4789-bf21-0e531d47dc6a"; // let's use a real or valid uuid format
    const userUuid = "904b77db-a2d3-4629-87a8-12cd2bfdc610";
    
    // Turn 1
    const q1 = "صندوق أبوظبي";
    console.log("Q1:", q1);
    const r1 = await runPipeline(q1, [], state, null, history, supabase, [], userUuid, sessionUuid, "88e7b9be-9b16-43a9-83f5-7c089d81d2da");
    console.log("R1 Symbols:", r1.plan.entities.symbols);
    console.log("R1 Response:\n", r1.response);
}

test();
