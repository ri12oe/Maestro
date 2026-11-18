import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  tseslint.configs.recommended,
  {
    // Hooks rules apply to the React app only.
    files: ['client/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // Effects already set state when a dialog opens or a prop arrives.
      'react-hooks/set-state-in-effect': 'off',
      // Pages call Date.now() while rendering to measure staleness and ranges.
      'react-hooks/purity': 'off',
      // People groups rows by assigning a local day cursor inside map.
      'react-hooks/immutability': 'off',
      // useModal keeps the latest onClose on a ref during render.
      'react-hooks/refs': 'off',
      // useApi forwards a deps array to useCallback instead of an inline literal.
      'react-hooks/use-memo': 'off',
    },
  },
);
