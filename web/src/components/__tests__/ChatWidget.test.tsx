/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import ChatWidget from "../ChatWidget";
const sendMessage = jest.fn();
const chat = {isOpen: true, setIsOpen: jest.fn(), messages: [], sendMessage, stopResponding: jest.fn(), isLoading: false, remainingQuota: 99, sessions: [], selectedModel: "deepseek-chat", setSelectedModel: jest.fn(), setShowUpgradeModal: jest.fn(), setIsSidebarOpen: jest.fn()};
jest.mock("@/contexts/ChatContext", () => ({useChat: () => chat, AVAILABLE_AI_MODELS: [{id: "deepseek-chat", name: "DeepSeek"}]}));
jest.mock("@/contexts/AuthContext", () => ({useAuth: () => ({user: {id: "user", email: "test@example.com"}})}));
jest.mock("@/contexts/LanguageContext", () => ({useLanguage: () => ({language: "ar"})}));
jest.mock("next/navigation", () => ({useRouter: () => ({push: jest.fn()})}));
jest.mock("next/image", () => ({__esModule: true, default: (props: any) => <img {...props} />}));
jest.mock("@/components/chat/ChatSidebar", () => ({ChatSidebar: () => null}));
jest.mock("@/components/chat/FormattedChatMessage", () => ({FormattedChatMessage: () => null}));
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
test("ARTORO composer shrinks after clearing long input and after reopening", () => {
    const { rerender } = render(<ChatWidget />);
    const input = screen.getByPlaceholderText("اسأل ARTORO...") as HTMLTextAreaElement;
    expect(screen.getByText("ARTORO")).toBeTruthy();
    expect(input.style.height).toBe("40px");
    Object.defineProperty(input, "scrollHeight", {configurable: true, value: 300});
    fireEvent.change(input, {target: {value: "long\nmessage"}});
    expect(input.style.height).toBe("160px");
    fireEvent.change(input, {target: {value: ""}});
    expect(input.style.height).toBe("40px");
    chat.isOpen = false; rerender(<ChatWidget />);
    chat.isOpen = true; rerender(<ChatWidget />);
    expect((screen.getByPlaceholderText("اسأل ARTORO...") as HTMLTextAreaElement).style.height).toBe("40px");
});
