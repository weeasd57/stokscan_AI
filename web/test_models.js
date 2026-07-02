async function test() {
  try {
    const baseUrl = process.env.WEB_ORIGIN || "http://127.0.0.1:3000";
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/models/list`);
    const json = await res.json();
    console.log("Models list response:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
