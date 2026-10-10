import { NextRequest } from "next/server";
import { GET } from "../route";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
jest.mock("@/lib/admin-auth",()=>({requireAdmin:jest.fn()}));
jest.mock("@/lib/supabase/route-data",()=>({getSupabaseServiceClient:jest.fn()}));
const auth=requireAdmin as jest.Mock, db=getSupabaseServiceClient as jest.Mock;
beforeEach(()=>{jest.clearAllMocks();auth.mockResolvedValue({user:{id:"admin"}});});
test("unauthorized and unlocked-but-not-signed-in requests cannot read traces",async()=>{
    auth.mockResolvedValueOnce(new Response("",{status:401}));
    expect((await GET(new NextRequest("https://test/trace?action=access"))).status).toBe(401);
    auth.mockResolvedValueOnce({user:null});
    expect((await GET(new NextRequest("https://test/trace?action=access"))).status).toBe(401);expect(db).not.toHaveBeenCalled();
});
test("valid admin traces are bounded to that signed-in user and chosen session",async()=>{
    const query:any={select:jest.fn(),eq:jest.fn(),order:jest.fn(),limit:jest.fn().mockResolvedValue({data:[{id:"a",trace:{complete:true}}]})};
    for(const key of ["select","eq","order"])query[key].mockReturnValue(query);
    db.mockReturnValue({from:()=>query});
    const response=await GET(new NextRequest("https://test/trace?session_id=00000000-0000-4000-8000-000000000001"));
    expect(response.status).toBe(200);expect(query.eq).toHaveBeenCalledWith("user_id","admin");expect(query.limit).toHaveBeenCalledWith(2);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
test("invalid session is rejected before reading database",async()=>{
    expect((await GET(new NextRequest("https://test/trace?session_id=wrong"))).status).toBe(400);expect(db).not.toHaveBeenCalled();
});
