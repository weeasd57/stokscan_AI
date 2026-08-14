import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envContent = fs.readFileSync("./.env.local", "utf8");
const envVars = Object.fromEntries(
  envContent
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
      const idx = line.indexOf("=");
      return idx === -1 ? [line, ""] : [line.slice(0, idx), line.slice(idx + 1)];
    })
);

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkF() {
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("symbol, name")
    .like("symbol", "F%")
    .limit(50);

  console.log("=== Stocks starting with F ===");
  console.log(stocks || error);
}

checkF();
