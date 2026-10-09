/** @jest-environment node */
import {NextRequest} from "next/server";
import {GET} from "../route";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {getSupabaseClient} from "@/lib/supabase/route-data";
jest.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:jest.fn()}));
jest.mock("@/lib/supabase/route-data",()=>({getSupabaseClient:jest.fn(),getSupabaseServiceClient:jest.fn()}));
jest.mock("@/lib/ai/server-secrets",()=>({getDeepSeekApiKey:()=>null,getNvidiaApiKeys:()=>[],isUnlimitedChatUser:()=>false}));
test("reopening a user-owned session restores suggestions without exposing other metadata",async()=>{
    const questions=["اختبر الاتجاه وMACD على AFMC خلال آخر 60 جلسة"];
    const chain:any={select:jest.fn(),eq:jest.fn(),order:jest.fn().mockResolvedValue({data:[{role:"assistant",content:"تحليل AFMC",created_at:"2026-10-09T19:00:00Z",metadata:{suggested_buttons:questions,tool_sources:{private:"not-for-client"}}}],error:null})};
    chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);
    (getSupabaseClient as jest.Mock).mockReturnValue({from:jest.fn().mockReturnValue(chain)});
    (createSupabaseServerClient as jest.Mock).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"owner"}},error:null})}});
    const response=await GET(new NextRequest("http://localhost/api/ai-chat?session_id=session"));
    expect(response.status).toBe(200);const data=await response.json();
    expect(data.history[0].suggestedButtons).toEqual(questions);expect(data.history[0].metadata).toBeUndefined();
    expect(chain.eq).toHaveBeenCalledWith("user_id","owner");expect(chain.eq).toHaveBeenCalledWith("session_id","session");
});
test("session suggestions remain authenticated",async()=>{
    (createSupabaseServerClient as jest.Mock).mockResolvedValue({auth:{getUser:async()=>({data:{user:null},error:null})}});
    expect((await GET(new NextRequest("http://localhost/api/ai-chat?session_id=session"))).status).toBe(401);
});
