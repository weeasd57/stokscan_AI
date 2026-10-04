jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const mockFrom = jest.fn();
jest.mock('../supabase/route-data', () => ({ getSupabaseServiceClient: () => ({ from: mockFrom }) }));
import { getPublicReports } from './public-reports';

const report = { session_date: '2026-10-04', kind: 'market', content: 'تقرير', job_run_id: 'job', evidence: [], created_at: '2026-10-04', updated_at: '2026-10-04' };
const job = { id: 'job', job_type: 'daily_bot', status: 'completed', started_at: '2026-10-04T14:00:00Z', steps: ['sync_prices', 'calculate_indicators', 'refresh_market_status'].map(step => ({ step, status: 'success' })) };
function setup(j: any, error: unknown = null) {
  mockFrom.mockImplementation((table: string) => {
    const chain: any = {};
    ['select', 'in', 'eq', 'gte'].forEach(k => chain[k] = jest.fn(() => chain));
    chain.order = jest.fn(async () => ({ data: [report], error }));
    chain.then = (resolve: any) => Promise.resolve({ data: [j], error: null }).then(resolve);
    return chain;
  });
}
test('publishes only safe fields from a completed matching job', async () => {
  setup(job);
  const result = await getPublicReports();
  expect(result).toHaveLength(1);
  expect(result[0]).not.toHaveProperty('job_run_id');
});
test.each([
  { ...job, status: 'running' },
  { ...job, started_at: '2026-10-03T14:00:00Z' },
  { ...job, steps: [] },
  { ...job, steps: 'invalid json' },
])('does not publish incomplete, mismatched or malformed jobs', async j => {
  setup(j);
  expect(await getPublicReports()).toEqual([]);
});
test('does not cache database failure as an empty successful archive', async () => {
  setup(job, { message: 'unavailable' });
  await expect(getPublicReports()).rejects.toThrow('Unable to load');
});
