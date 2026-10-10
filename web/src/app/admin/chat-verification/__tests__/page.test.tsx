/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "../page";
const send=jest.fn(async(_prompt: string)=>{}), open=jest.fn();
jest.mock("@/contexts/ChatContext",()=>({useChat:()=>({sendMessage:send,setIsOpen:open,isLoading:false,activeSessionId:null,selectedModel:"deepseek-chat",messages:[],createNewSession:jest.fn()})}));
jest.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:{id:"admin"}})}));
test("runs cases through the actual ChatContext action and makes no manufactured success claim",async()=>{
    global.fetch=jest.fn(async()=>({ok:true,json:async()=>({authorized:true,deployment_sha:"deployed"})})) as any;
    render(<Page/>);await waitFor(()=>expect((screen.getByText("اختبار 1: 60 / 25 / 15") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("اختبار 1: 60 / 25 / 15"));await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));expect(open).toHaveBeenCalledWith(true);expect(send.mock.calls[0][0]).toContain("COMI بنسبة 60%");expect(screen.queryByText("الاختبار ناجح")).toBeNull();
});
