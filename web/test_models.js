async function test() {
  try {
    const res = await fetch("http://127.0.0.1:8000/admin/train/models");
    const json = await res.json();
    console.log("Models list response:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
