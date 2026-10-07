/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import DailyJobsTab from "../../app/admin/components/DailyJobsTab";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/hooks/useRealtimeRefresh", () => ({ useRefreshOnVisibility: jest.fn() }));

test("admin can change midday time without changing the after-close time", async () => {
  const schedule = { enabled: true, run_time: "17:00", midday_run_time: "12:15", active_days: [0,1,2,3,4], run_history: [] };
  const writes: any[] = [];
  global.fetch = jest.fn(async (url, options) => {
    const isSchedule = String(url).endsWith("/schedule");
    if (options?.method === "POST") {
      writes.push(JSON.parse(String(options.body)));
      Object.assign(schedule, writes.at(-1));
    }
    return { ok: true, json: async () => isSchedule ? { ...schedule } : { history: [], recommendations: [] } } as Response;
  });
  const { container, getByText } = render(<DailyJobsTab />);
  await waitFor(() => expect((container.querySelectorAll('input[type="time"]')[1] as HTMLInputElement)?.value).toBe("17:00"));
  const inputs = container.querySelectorAll('input[type="time"]');
  expect((inputs[0] as HTMLInputElement).value).toBe("12:15");
  expect((inputs[1] as HTMLInputElement).value).toBe("17:00");
  expect(getByText(/التوصيات العادية والتقارير/)).toBeTruthy();
  fireEvent.change(inputs[0], { target: { value: "12:30" } });
  await waitFor(() => expect(writes).toEqual([{ midday_run_time: "12:30" }]));
  expect(schedule.run_time).toBe("17:00");
});
