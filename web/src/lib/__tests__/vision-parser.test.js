const { extractJsonFromResponse } = require('../ai/vision');

describe('vision parser', () => {
  it('repairs a missing symbols array close before technical observations', () => {
    const data = extractJsonFromResponse('{"image_type":"table","symbols":[{"symbol":"KRDI","name":"","visible_values":{"price":"22,700","change_pct":null,"quantity":null}},"technical_observations":[],"market_depth":{"total_bid":null,"total_ask":null,"spread":null},"user_relevant_summary":null,"uncertainties":null,"confidence":0}');
    expect(data.symbols[0].symbol).toBe('KRDI');
    expect(data.symbols[0].visible_values.price).toBe('22,700');
  });

  it('parses single-quoted JSON emitted by some vision responses', () => {
    const data = extractJsonFromResponse("{'image_type': 'table', 'symbols': [{'symbol': 'EDFM', 'name': 'EDFM', 'visible_values': {'price': '124,569', 'change_pct': '0.70%', 'quantity': 'null'}}], 'technical_observations': [], 'market_depth': {}, 'user_relevant_summary': '', 'uncertainties': [], 'confidence': 0.4}");
    expect(data.symbols[0].symbol).toBe('EDFM');
    expect(data.symbols[0].visible_values.price).toBe('124,569');
  });

  it('salvages explicit symbol keys from malformed JSON without numeric guesses', () => {
    const data = extractJsonFromResponse("{'image_type':'table','symbols':[{'symbol':'EDFM','visible_values':{'price':'124,569'}}, {'symbol':'SCFM'}");
    expect(data.symbols.map(symbol => symbol.symbol)).toEqual(['EDFM', 'SCFM']);
    expect(data.symbols[0].visible_values.price).toBeNull();
  });

  it('accepts a JSON object wrapped in prose', () => {
    const data = extractJsonFromResponse('Here is the JSON:\n{"image_type":"table","symbols":[],"technical_observations":[],"market_depth":{"total_bid":null,"total_ask":null,"spread":null},"user_relevant_summary":"ok","uncertainties":[],"confidence":0.5}');
    expect(data.image_type).toBe('table');
  });
});
