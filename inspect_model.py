import pickle
obj = pickle.load(open('api/models/NEW_MODEL.pkl', 'rb'))
pm = obj.get('primary_model', {})
feats = pm.get('feature_names', [])
print('Feature Count:', len(feats))
print('First 15 features:')
for i, f in enumerate(feats[:15]):
    print(f'  {i+1}. {f}')
print('...')
print('Last 5 features:')
for f in feats[-5:]:
    print('  -', f)
