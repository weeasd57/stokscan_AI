/** @jest-environment jsdom */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import PanelSymbolSearch from "./PanelSymbolSearch";
import { searchSymbols } from "@/lib/api";
jest.mock("@/lib/api", () => ({ searchSymbols: jest.fn() }));
const rows = [
  {
    symbol: "EAST",
    name: "Eastern Company",
    exchange: "EGX",
    country: "Egypt",
  },
  {
    symbol: "COMI",
    name: "Commercial International Bank",
    exchange: "EGX",
    country: "Egypt",
  },
];
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (searchSymbols as jest.Mock).mockResolvedValue(rows);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
const settle = async () =>
  act(async () => {
    jest.advanceTimersByTime(250);
    await Promise.resolve();
  });
test("debounces name search and selects the result for its own panel", async () => {
  const select = jest.fn();
  render(
    <PanelSymbolSearch symbol="COMI" index={1} ar={false} onSelect={select} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Eastern" } });
  expect(searchSymbols).not.toHaveBeenCalled();
  await settle();
  expect(searchSymbols).toHaveBeenCalledWith(
    "Eastern",
    "Egypt",
    12,
    expect.any(AbortSignal),
    "supabase",
    "EGX",
  );
  fireEvent.click(screen.getByRole("option", { name: /EAST Eastern Company/ }));
  expect(select).toHaveBeenCalledWith("EAST");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
test("arrow keys and Enter select a stock, Escape closes results", async () => {
  const select = jest.fn();
  render(
    <PanelSymbolSearch symbol="COMI" index={0} ar={false} onSelect={select} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await settle();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.submit(input.closest("form")!);
  expect(select).toHaveBeenCalledWith("EAST");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveAttribute("aria-expanded", "false");
});
test("ignores late search responses after the query changes", async () => {
  let resolve!: (value: unknown) => void;
  (searchSymbols as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((value) => {
        resolve = value;
      }),
  );
  render(
    <PanelSymbolSearch
      symbol="COMI"
      index={0}
      ar={false}
      onSelect={jest.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await settle();
  const previousSignal = (searchSymbols as jest.Mock).mock.calls[0][3];
  fireEvent.change(input, { target: { value: "Eastern" } });
  await settle();
  expect(previousSignal.aborted).toBe(true);
  await act(async () => {
    resolve([{ ...rows[0], symbol: "STALE", name: "Old result" }]);
    await Promise.resolve();
  });
  expect(screen.queryByText("STALE")).not.toBeInTheDocument();
});
test("shows empty and failed search states without selecting a stock", async () => {
  const select = jest.fn();
  (searchSymbols as jest.Mock)
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("offline"));
  render(
    <PanelSymbolSearch symbol="COMI" index={0} ar={false} onSelect={select} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await settle();
  expect(screen.getByText("No matching stocks")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "bank" } });
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent("Search failed");
  fireEvent.submit(input.closest("form")!);
  expect(select).not.toHaveBeenCalled();
});
test("does not replace the stock with an unverified symbol while loading or after no matches", async () => {
  const select = jest.fn();
  (searchSymbols as jest.Mock).mockResolvedValue([]);
  render(
    <PanelSymbolSearch symbol="COMI" index={0} ar={false} onSelect={select} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "UNKNOWN" } });
  fireEvent.submit(input.closest("form")!);
  expect(select).not.toHaveBeenCalled();
  await settle();
  fireEvent.submit(input.closest("form")!);
  expect(select).not.toHaveBeenCalled();
});
