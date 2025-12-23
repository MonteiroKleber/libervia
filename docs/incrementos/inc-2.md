# INCREMENTO 2 — ÍNDICES PARA CONSULTAS EFICIENTES

## VISÃO GERAL

O Incremento 2 adiciona **índices locais em memória** ao `EpisodioRepositoryImpl` para tornar as consultas eficientes, especialmente quando a base de episódios cresce.

### Princípios Preservados
- **NÃO ranking**: Índices não calculam relevância, apenas filtram
- **NÃO recomendação**: Índices não sugerem "melhores" resultados
- **Imutabilidade**: Episódios, decisões e contratos continuam imutáveis
- **Append-only para anexos**: Regra preservada

---

## ESTRUTURA DE ARQUIVOS

O Incremento 2 é **cumulativo** — não cria pastas separadas. Os arquivos modificados estão em:

```
incremento-1/
├── repositorios/
│   ├── interfaces/
│   │   └── EpisodioRepository.ts    # Adicionado getByIds()
│   └── implementacao/
│       └── EpisodioRepositoryImpl.ts # IndexManager + find() otimizado
└── testes/
    └── incremento2.test.ts           # Novos testes específicos
```

---

## ÍNDICES IMPLEMENTADOS

### 1. Índice por `caso_uso`
- **Tipo**: `Map<number, Set<string>>`
- **Uso**: Filtra episódios por caso de uso (1-5)
- **Complexidade**: O(1) para lookup

### 2. Índice por `estado`
- **Tipo**: `Map<EstadoEpisodio, Set<string>>`
- **Uso**: Filtra episódios por estado (CRIADO, DECIDIDO, EM_OBSERVACAO, ENCERRADO)
- **Complexidade**: O(1) para lookup
- **Atualização**: Sincronizado automaticamente em `updateEstado()`

### 3. Índice por `dominio`
- **Tipo**: `Map<string, Set<string>>` (chave em lowercase)
- **Uso**: Busca case-insensitive com match parcial
- **Complexidade**: O(k) onde k = número de domínios únicos

### 4. Índice por `data_criacao`
- **Tipo**: `Array<{ ts: number; id: string }>` ordenado
- **Uso**: Suporta ordenação e paginação eficiente via cursor
- **Ordenação**: Timestamp DESC, ID DESC (mais recente primeiro)

---

## CLASSE `IndexManager`

```typescript
class IndexManager {
  // Índices
  private byCasoUso: Map<number, Set<string>>;
  private byEstado: Map<EstadoEpisodio, Set<string>>;
  private byDominio: Map<string, Set<string>>;
  private byDataCriacao: Array<{ ts: number; id: string }>;

  // Métodos
  clear(): void;
  addEpisodio(e: EpisodioDecisao): void;
  updateEstado(id: string, estadoAntigo: EstadoEpisodio, estadoNovo: EstadoEpisodio): void;
  sortByDataCriacao(): void;
  getIdsByCasoUso(caso_uso: number): Set<string> | undefined;
  getIdsByEstado(estado: EstadoEpisodio): Set<string>;
  getIdsByDominio(dominio: string): Set<string>;
  getIdsOrdenadosPorData(cursor?: ParsedCursor): string[];
  getAllIds(): string[];
}
```

---

## ESTRATÉGIA DE CONSULTA OTIMIZADA

O método `find()` agora segue esta estratégia:

### Fase 1: Obter candidatos via índices
1. Se há filtro por `caso_uso` → usar índice `byCasoUso`
2. Se há filtro por `estado` → usar índice `byEstado`
3. Se há filtro por `dominio` → usar índice `byDominio`
4. Se múltiplos filtros → **intersecção** dos conjuntos

### Fase 2: Ordenação
- Usar índice `byDataCriacao` para obter IDs ordenados
- Aplicar cursor se fornecido

### Fase 3: Filtros não indexados
- `data_inicio` e `data_fim` são aplicados após obter candidatos
- Estes filtros fazem scan linear apenas sobre os candidatos já filtrados

### Fase 4: Paginação
- Aplicar `limit` (máximo 100, padrão 20)
- Gerar `next_cursor` se há mais resultados

---

## MÉTODO `getByIds()` (NOVO)

Adicionado para batch lookup:

```typescript
async getByIds(ids: string[]): Promise<Map<string, EpisodioDecisao>>
```

**Uso**: Preparação para otimização futura do problema N+1 no `MemoryQueryService`.

---

## TESTES DO INCREMENTO 2

### Testes de índices
1. **Índice por caso_uso**: Filtra corretamente
2. **Índice por estado**: Filtra e atualiza após `updateEstado()`
3. **Índice por domínio**: Case-insensitive e match parcial

### Testes de combinação
4. **Múltiplos filtros**: Intersecção funciona
5. **Filtros por data**: `data_inicio` e `data_fim`

### Testes de paginação
6. **Cursor**: Paginação correta sem duplicatas
7. **Limite máximo**: Respeitado (100)

### Testes de persistência
8. **Reload**: Índices reconstruídos após `init()`

### Testes de batch
9. **getByIds**: Retorna Map correto

### Testes de integração
10. **MemoryQueryService**: Usa índices via `find()`

### Testes de performance (INCREMENTO 2.1)
11. **Validação determinística de índices**: O teste de performance foi convertido para teste determinístico de caminho indexado (sem asserts de tempo absoluto) para estabilidade em CI. Valida que `find()` usa índices e reduz candidatos >90%.

### Garantias preservadas
12. **Incremento 1**: DELETE não existe, transições validadas, clone não expõe referência

---

## GARANTIAS PRESERVADAS DO INCREMENTO 1

| Garantia | Status |
|----------|--------|
| Episódio não pode ser deletado | ✅ |
| Decisão não pode ser alterada | ✅ |
| Contrato não pode ser alterado | ✅ |
| Núcleo da situação trava a partir de ACEITA | ✅ |
| Anexo é append-only | ✅ |
| Consulta só em EM_ANALISE | ✅ |
| MemoryQueryService não faz ranking | ✅ |
| Persistência e recuperação | ✅ |
| Batch lookup | ✅ |

---

## EXEMPLO DE USO

```typescript
// Criar repositório
const episodioRepo = await EpisodioRepositoryImpl.create('./data');

// Consulta simples (usa índice)
const result1 = await episodioRepo.find({ caso_uso: 1 });

// Consulta combinada (usa intersecção de índices)
const result2 = await episodioRepo.find({
  caso_uso: 1,
  estado: EstadoEpisodio.DECIDIDO,
  dominio: 'Financeiro'
});

// Consulta com data e paginação
const result3 = await episodioRepo.find({
  caso_uso: 2,
  data_inicio: new Date('2024-01-01'),
  limit: 50
});

// Próxima página
const result4 = await episodioRepo.find({
  caso_uso: 2,
  data_inicio: new Date('2024-01-01'),
  limit: 50,
  cursor: result3.next_cursor
});
```

---

## COMPLEXIDADE

| Operação | Antes (Inc 1) | Depois (Inc 2) |
|----------|---------------|----------------|
| find() sem filtro indexado | O(n) | O(n) |
| find() com caso_uso | O(n) | O(m) onde m = matches |
| find() com estado | O(n) | O(m) |
| find() com domínio parcial | O(n) | O(k × m) |
| find() com múltiplos filtros | O(n) | O(min(m1, m2, ...)) |
| updateEstado() | O(n) escrita | O(n) escrita + O(1) índice |
| create() | O(n) escrita | O(n) escrita + O(n log n) sort |

**Nota**: `n` = total de episódios, `m` = matches do filtro, `k` = domínios únicos

---

## NOTAS DE IMPLEMENTAÇÃO

1. **Índices são reconstruídos no `init()`**: Não há persistência separada para índices
2. **Ordenação após create()**: O índice `byDataCriacao` é re-ordenado após cada criação
3. **updateEstado() atualiza índice**: Remove do conjunto antigo, adiciona ao novo
4. **Match parcial de domínio**: Iteração sobre todas as chaves do Map
5. **Cursor usa timestamp|id**: Formato determinístico para paginação estável
6. **Debug stats (INCREMENTO 2.1)**: Método `_debugIndexStats()` disponível apenas para testes, retorna estatísticas da última chamada `find()` sem alterar estado ou persistir dados

---

## PRÓXIMOS PASSOS (INCREMENTO 3+)

Sugestões para incrementos futuros:
- Índice por `perfil_risco` (requer join com DecisaoRepository)
- Índice por `data_decisao` para consultas de histórico
- Cache de consultas frequentes
- Compactação de índices para datasets muito grandes
