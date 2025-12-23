# INCREMENTO 3 — PROTOCOLO FORMAL DE DECISÃO INSTITUCIONAL

## VISÃO GERAL

O Incremento 3 introduz o **DecisionProtocol** — um artefato formal e imutável que **formaliza o raciocínio institucional mínimo exigido** antes que uma decisão possa ser registrada.

### Princípio Fundamental

> **A Libervia não decide porque calcula. Decide porque respeita um protocolo.**

---

## NOVO FLUXO DE DECISÃO

### Antes (Incrementos 0-2)

```
Situação → Episódio → Decisão → Contrato
```

### Agora (Incremento 3)

```
Situação → Episódio → Protocolo → Decisão → Contrato
```

🚫 **É PROIBIDO criar decisão sem protocolo VALIDADO.**

---

## NOVOS ARTEFATOS

### 1. EstadoProtocolo (Enum)

```typescript
enum EstadoProtocolo {
  EM_CONSTRUCAO = 'EM_CONSTRUCAO',
  VALIDADO = 'VALIDADO',
  REJEITADO = 'REJEITADO'
}
```

**Estados terminais**: VALIDADO e REJEITADO são terminais — o protocolo não pode mudar após ser criado.

### 2. DecisionProtocol (Interface)

```typescript
interface DecisionProtocol {
  id: string;
  episodio_id: string;

  // Elementos mínimos obrigatórios
  criterios_minimos: string[];
  riscos_considerados: string[];
  limites_definidos: Limite[];

  // Perfil de risco explícito
  perfil_risco: PerfilRisco;

  // Alternativas avaliadas e escolha
  alternativas_avaliadas: string[];
  alternativa_escolhida: string;

  // Rastreabilidade
  memoria_consultada_ids: string[];
  anexos_utilizados_ids: string[];

  // Estado do protocolo
  estado: EstadoProtocolo;

  // Validação
  validado_em: Date;
  validado_por: 'Libervia';

  // Motivo de rejeição (se aplicável)
  motivo_rejeicao?: string;
}
```

### 3. DadosProtocoloInput (Interface)

```typescript
interface DadosProtocoloInput {
  criterios_minimos: string[];
  riscos_considerados: string[];
  limites_definidos: Limite[];
  perfil_risco: PerfilRisco;
  alternativas_avaliadas: string[];
  alternativa_escolhida: string;
  memoria_consultada_ids?: string[];
}
```

---

## VALIDAÇÕES OBRIGATÓRIAS

O método `ConstruirProtocoloDeDecisao` aplica as seguintes validações:

| # | Validação | Resultado se falhar |
|---|-----------|---------------------|
| 1 | Episódio existe | Erro (throw) |
| 2 | Episódio está em CRIADO | Erro (throw) |
| 3 | Situação está em EM_ANALISE | Erro (throw) |
| 4 | Já existe protocolo para episódio | Erro (throw) |
| 5 | criterios_minimos não vazio | REJEITADO |
| 6 | riscos_considerados não vazio | REJEITADO |
| 7 | limites_definidos não vazio | REJEITADO |
| 8 | alternativas_avaliadas ≥ 2 | REJEITADO |
| 9 | alternativa_escolhida não vazio | REJEITADO |
| 10 | alternativa_escolhida ∈ alternativas_avaliadas | REJEITADO |
| 11 | memoria_consultada_ids registrados como anexo | REJEITADO |

**Nota**: Validações 1-4 lançam erros imediatos. Validações 5-11 resultam em protocolo REJEITADO (persistido com motivo).

---

## REPOSITÓRIO

### DecisionProtocolRepository

```typescript
interface DecisionProtocolRepository {
  init(): Promise<void>;
  create(protocolo: DecisionProtocol): Promise<void>;
  getById(id: string): Promise<DecisionProtocol | null>;
  getByEpisodioId(episodio_id: string): Promise<DecisionProtocol | null>;
  getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisionProtocol>>;

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}
```

---

## ORQUESTRADOR ATUALIZADO

### Novo Método: ConstruirProtocoloDeDecisao

```typescript
async ConstruirProtocoloDeDecisao(
  episodio_id: string,
  dados: DadosProtocoloInput
): Promise<DecisionProtocol>
```

### RegistrarDecisao Atualizado

Agora requer:
1. Protocolo existente para o episódio
2. Protocolo em estado VALIDADO
3. Consistência entre protocolo e decisão:
   - `alternativa_escolhida` deve ser igual
   - `perfil_risco` deve ser igual

---

## O QUE O PROTOCOLO NÃO FAZ

| Ação | Status |
|------|--------|
| Executar | ❌ NÃO |
| Recomendar | ❌ NÃO |
| Aprender | ❌ NÃO |
| Alterar memória | ❌ NÃO |
| Interpretar resultados | ❌ NÃO |
| Calcular scores | ❌ NÃO |
| Sugerir alternativas | ❌ NÃO |
| Prever outcomes | ❌ NÃO |

O protocolo **APENAS formaliza o raciocínio institucional mínimo exigido**.

---

## RASTREABILIDADE

O protocolo mantém rastreabilidade completa:

1. **memoria_consultada_ids**: IDs de episódios consultados via `ConsultarMemoriaDuranteAnalise`
2. **anexos_utilizados_ids**: IDs de todos os anexos da situação no momento da validação

Isso garante que qualquer memória usada na decisão:
- Foi formalmente consultada durante EM_ANALISE
- Foi registrada como anexo (append-only)
- Pode ser auditada posteriormente

---

## TESTES DO INCREMENTO 3

| # | Teste | Descrição |
|---|-------|-----------|
| 1 | Decisão sem protocolo | Erro ao tentar registrar decisão sem protocolo |
| 2 | Protocolo incompleto | Campos vazios geram REJEITADO |
| 3 | Alternativa inválida | alternativa_escolhida fora de alternativas_avaliadas → REJEITADO |
| 4 | Memória sem anexo | memoria_consultada_ids sem registro → REJEITADO |
| 5 | Fluxo completo | Situação → Episódio → Protocolo → Decisão → Contrato |
| 6 | Protocolo rejeitado | Não permite registrar decisão |
| 7 | Update/delete | Métodos não existem |
| 8 | Estados terminais | Não permite segundo protocolo para mesmo episódio |
| 9 | Consistência | Decisão deve coincidir com protocolo |
| 10 | Persistência | Protocolo sobrevive restart |
| 11 | protocoloRepo obrigatório | RegistrarDecisao sem protocoloRepo → erro |
| 12 | Garantias anteriores | Decisão, contrato e episódio mantêm regras |

---

## REQUISITO: protocoloRepo OBRIGATÓRIO

O Incremento 3 **NÃO é retrocompatível**:

- `protocoloRepo` é **obrigatório** no constructor do OrquestradorCognitivo
- `RegistrarDecisao` sem `protocoloRepo` configurado → erro imediato
- `ConstruirProtocoloDeDecisao` sem `protocoloRepo` → erro explicativo
- **Não existe modo legado**: toda decisão requer protocolo VALIDADO

---

## ESTRUTURA DE ARQUIVOS

```
incremento-1/
├── entidades/
│   └── tipos.ts                          # +EstadoProtocolo, DecisionProtocol
├── repositorios/
│   ├── interfaces/
│   │   └── DecisionProtocolRepository.ts # NOVO
│   └── implementacao/
│       └── DecisionProtocolRepositoryImpl.ts # NOVO
├── orquestrador/
│   └── OrquestradorCognitivo.ts          # +ConstruirProtocoloDeDecisao
└── testes/
    └── incremento3.test.ts               # NOVO (12 testes)
```

---

## EXEMPLO DE USO

```typescript
// 1. Criar orquestrador com protocoloRepo
const orquestrador = new OrquestradorCognitivo(
  situacaoRepo,
  episodioRepo,
  decisaoRepo,
  contratoRepo,
  memoryService,
  protocoloRepo  // OBRIGATÓRIO: sem isso, RegistrarDecisao falha
);

// 2. Processar solicitação (cria episódio em CRIADO)
const episodio = await orquestrador.ProcessarSolicitacao(situacao);

// 3. (Opcional) Consultar memória
await orquestrador.ConsultarMemoriaDuranteAnalise(situacao.id, { caso_uso: 1 });

// 4. Construir protocolo formal
const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, {
  criterios_minimos: ['Custo', 'Prazo', 'Risco'],
  riscos_considerados: ['Atraso no cronograma', 'Estouro de orçamento'],
  limites_definidos: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
  perfil_risco: PerfilRisco.MODERADO,
  alternativas_avaliadas: ['Opção A', 'Opção B'],
  alternativa_escolhida: 'Opção A'
});

// 5. Verificar se foi validado
if (protocolo.estado !== EstadoProtocolo.VALIDADO) {
  console.error('Protocolo rejeitado:', protocolo.motivo_rejeicao);
  return;
}

// 6. Registrar decisão (agora permitido)
const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
  alternativa_escolhida: 'Opção A',  // Deve coincidir com protocolo
  criterios: ['Custo', 'Prazo', 'Risco'],
  perfil_risco: PerfilRisco.MODERADO,  // Deve coincidir com protocolo
  limites: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
  condicoes: ['Aprovação do comitê']
});

// 7. Contrato emitido para Bazari
console.log('Contrato:', contrato.id);
```

---

## GARANTIAS PRESERVADAS

| Incremento | Garantia | Status |
|------------|----------|--------|
| 0 | SituaçãoDecisoria imutável a partir de ACEITA | ✅ |
| 0 | Máquina de estados rígida para Episódio | ✅ |
| 0 | DecisaoInstitucional imutável (1 por episódio) | ✅ |
| 0 | ContratoDeDecisao imutável (1 por episódio) | ✅ |
| 1 | Anexo append-only | ✅ |
| 1 | Consulta só em EM_ANALISE | ✅ |
| 1 | MemoryQueryService sem ranking | ✅ |
| 2 | Índices para consultas eficientes | ✅ |
| 3 | Protocolo obrigatório antes de decisão | ✅ NOVO |
| 3 | Protocolo imutável após criação | ✅ NOVO |
| 3 | Rastreabilidade de memória consultada | ✅ NOVO |

---

## PRÓXIMOS PASSOS (INCREMENTO 4+)

Sugestões para incrementos futuros:
- Observação estruturada após decisão
- Feedback loop para aprendizado institucional (sem IA opinativa)
- Métricas de eficácia de decisões anteriores
- Alertas de violação de limites durante execução
