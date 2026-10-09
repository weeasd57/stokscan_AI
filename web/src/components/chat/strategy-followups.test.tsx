/** @jest-environment jsdom */
import React from "react";
import {render,screen,fireEvent} from "@testing-library/react";
import {FormattedChatMessage} from "./FormattedChatMessage";
import {stockStrategyFollowups} from "@/lib/ai/strategy-followups";
test("stock strategy button sends its explicit-stock question through the existing chat handler",()=>{
    const questions=stockStrategyFollowups([{tool:"get_stock",symbols:["AFMC"],availability:"available",data:{stocks:[{symbol:"AFMC",close:152}]}}],true)!;
    const send=jest.fn();render(<FormattedChatMessage role="assistant" content="تحليل AFMC" suggestedButtons={questions} onButtonClick={send}/>);
    fireEvent.click(screen.getByRole("button",{name:questions[2]}));
    expect(send).toHaveBeenCalledWith("اختبر الاتجاه وMACD على AFMC خلال آخر 60 جلسة");
    expect(screen.getByRole("button",{name:questions[0]})).toBeTruthy();
});
