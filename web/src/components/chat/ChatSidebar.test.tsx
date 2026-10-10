/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatSidebar } from "./ChatSidebar";

const baseProps = {
    sessions: [],
    activeSessionId: null,
    onSelectSession: jest.fn(),
    onNewChat: jest.fn(),
    onDeleteSession: jest.fn(),
    onRenameSession: jest.fn(),
    onToggle: jest.fn(),
};

test("closed history does not add a second launcher beside the chat header", () => {
    const { container } = render(<ChatSidebar {...baseProps} isOpen={false} />);
    expect(container.childElementCount).toBe(0);
});

test("open history aligns as a framed panel and exposes one close action", () => {
    render(<ChatSidebar {...baseProps} isOpen />);
    expect(screen.getByRole("complementary", { name: "سجل المحادثات" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "محادثة جديدة" })).toBeTruthy();
    const close = screen.getByRole("button", { name: "إغلاق سجل المحادثات" });
    expect(close).toBeTruthy();
    fireEvent.click(close);
    expect(baseProps.onToggle).toHaveBeenCalledTimes(1);
});
