/**
 * LIBERVIA — ESLint Configuration
 * Incremento 23 — Deploy Baseline + CI/CD
 *
 * Configuração tolerante para não quebrar código existente.
 * Foca em erros críticos, não em estilo.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended'
  ],
  env: {
    node: true,
    es2020: true,
    jest: true
  },
  rules: {
    // ────────────────────────────────────────────────────────────────────────
    // Desabilitar regras que quebram código existente
    // ────────────────────────────────────────────────────────────────────────
    'no-unused-vars': 'off',           // Muitos warnings em código existente
    '@typescript-eslint/no-unused-vars': 'off',
    'no-undef': 'off',                 // TypeScript já valida isso
    'no-redeclare': 'off',             // TypeScript já valida isso

    // ────────────────────────────────────────────────────────────────────────
    // Erros reais (manter ativados)
    // ────────────────────────────────────────────────────────────────────────
    'no-dupe-keys': 'error',           // Chaves duplicadas em objetos
    'no-duplicate-case': 'error',      // Cases duplicados em switch
    'no-empty': 'warn',                // Blocos vazios
    'no-extra-semi': 'warn',           // Ponto e vírgula extra
    'no-unreachable': 'warn',          // Código inalcançável

    // ────────────────────────────────────────────────────────────────────────
    // Segurança
    // ────────────────────────────────────────────────────────────────────────
    'no-eval': 'error',                // Proibir eval()
    'no-implied-eval': 'error',        // Proibir eval implícito
    'no-new-func': 'error',            // Proibir new Function()
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    'test-data*/',
    'test-artifacts/',
    '*.js',                            // Ignorar arquivos JS gerados
    'sdk/dist/'
  ]
};
