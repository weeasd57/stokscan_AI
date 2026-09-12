const { extractJsonFromResponse, validateVisionOutput, reconcileVisionWithMarket } = require('../ai/vision');

describe('vision output validation', () => {
  it('accepts numeric strings with thousands separators and string nulls', () => {
    const parsed = extractJsonFromResponse("{'image_type': 'table', 'symbols': [{'symbol': 'EDFM', 'name': 'EDFM', 'visible_values': {'price': '124,569', 'change_pct': '0.70%', 'quantity': 'null'}}], 'technical_observations': [], 'market_depth': {}, 'user_relevant_summary': '', 'uncertainties': [], 'confidence': 0.4}");
    const vision = validateVisionOutput(parsed);
    expect(vision).not.toBeNull();
    expect(vision.symbols[0].symbol).toBe('EDFM');
    expect(vision.symbols[0].visible_values.price).toBe(124569);
    expect(vision.symbols[0].visible_values.change_pct).toBeCloseTo(0.7, 5);
    expect(vision.symbols[0].visible_values.quantity).toBeNull();
  });

  it('keeps an ungrouped large price converted to its decimal form', () => {
    const parsed = extractJsonFromResponse('{"image_type":"table","symbols":[{"symbol":"BIOC","name":"","visible_values":{"price":18150,"change_pct":null,"quantity":null}}],"technical_observations":[],"market_depth":{"total_bid":null,"total_ask":null,"spread":null},"user_relevant_summary":"","uncertainties":[],"confidence":0.6}');
    const vision = validateVisionOutput(parsed);
    expect(vision.symbols[0].visible_values.price).toBeCloseTo(181.5, 2);
  });

  it('recovers symbols when the model returns a plain string array', () => {
    const parsed = extractJsonFromResponse('{"image_type":"financial","symbols":["AMER"],"technical_observations":[],"confidence":0.5}');
    const vision = validateVisionOutput(parsed);
    expect(vision.symbols.map((symbol) => symbol.symbol)).toEqual(['AMER']);
  });

  it('recovers symbols from near-miss payloads rejected by the strict contract', () => {
    const parsed = extractJsonFromResponse('{"image_type":"TABLE","symbols":[{"symbol":"edfm","visible_values":{"price":"124,569","change_pct":"0.70%"}},{"symbol":"scfm","visible_values":{}}],"technical_observations":null,"confidence":"0.4"}');
    const vision = validateVisionOutput(parsed);
    expect(vision.symbols.map(symbol => symbol.symbol)).toEqual(['EDFM', 'SCFM']);
    expect(vision.image_type).toBe('unknown');
    expect(vision.symbols[0].visible_values.price).toBe(124569);
  });
});

describe('vision market reconciliation', () => {
  it('clears an implausible extracted price and keeps a plausible one', async () => {
    const vision = {
      image_type: 'table',
      symbols: [
        { symbol: 'EDFM', name: '', visible_values: { price: 124569, change_pct: 0.7, quantity: null } },
        { symbol: 'MOSC', name: '', visible_values: { price: 311.63, change_pct: 6.51, quantity: null } },
      ],
      technical_observations: [],
      market_depth: { total_bid: null, total_ask: null, spread: null },
      user_relevant_summary: '',
      uncertainties: [],
      confidence: 0.5,
    };
    const supabase = {
      from: () => ({
        select: () => ({
          in: () => ({ order: async () => ({ data: [{ symbol: 'EDFM', close: 417.45, date: '2026-09-10' }, { symbol: 'MOSC', close: 315, date: '2026-09-10' }] }) }),
        }),
      }),
    };
    const result = await reconcileVisionWithMarket(vision, supabase);
    expect(result.symbols[0].visible_values.price).toBeNull();
    expect(result.symbols[1].visible_values.price).toBe(311.63);
    expect(result.uncertainties.length).toBeGreaterThan(0);
  });
});
