# Incremento 7 - Interface Controlada Bazari <-> Libervia

**Data**: 2025-12-23
**Autor**: Libervia
**Status**: Em Implementacao
**Fase**: 4 - Integracao Controlada

---

## 1. Escopo

O Incremento 7 define a **interface de integracao** entre Bazari (executor) e Libervia (cerebro institucional), garantindo:

1. **Contrato unico de saida**: Toda decisao flui atraves de `ContratoDeDecisao`
2. **Sem vazamento de dados**: Adapter encapsula Orquestrador
3. **Auditabilidade**: Toda interacao e logada no EventLog
4. **Validacao obrigatoria**: Protocolo de decisao sempre validado antes

### 1.1 O que NAO esta no escopo

- APIs publicas HTTP (usa harness interno)
- Execucao de decisoes (responsabilidade Bazari)
- Interpretacao de resultados (Bazari faz isso)
- Modificacao do fluxo cognitivo existente

---

## 2. Modelo de Interacao

### 2.1 Diagrama de Fluxo

```
┌─────────┐                      ┌──────────────────┐                      ┌──────────────────────┐
│ Bazari  │ ──solicitarDecisao──>│ BazariAdapter    │ ──ProcessarSolic──> │ OrquestradorCognitivo│
│         │                      │                  │                      │                      │
│         │ <───────────────────── ContratoDeDecisao│ <─────────────────── │                      │
└─────────┘     (UNICA SAIDA)    └──────────────────┘                      └──────────────────────┘
                                        │
                                        │ encapsula
                                        ▼
                               ┌──────────────────┐
                               │ Nenhum acesso    │
                               │ direto a:        │
                               │ - Repositorios   │
                               │ - Estados inter. │
                               │ - EventLog raw   │
                               └──────────────────┘
```

### 2.2 Fluxo Detalhado

1. **Bazari** chama `BazariAdapter.solicitarDecisao(situacaoData)`
2. **Adapter** valida token de integracao (se configurado)
3. **Adapter** cria `SituacaoDecisoria` e chama `Orquestrador.ProcessarSolicitacao()`
4. **Orquestrador** valida, cria episodio, retorna episodio_id
5. **Adapter** recebe dados de protocolo de Bazari e chama `ConstruirProtocoloDeDecisao()`
6. **Orquestrador** valida protocolo (VALIDADO ou REJEITADO)
7. Se VALIDADO, **Adapter** chama `RegistrarDecisao()`
8. **Orquestrador** cria decisao e emite `ContratoDeDecisao`
9. **Adapter** retorna APENAS o `ContratoDeDecisao` para Bazari

### 2.3 Tipos de Chamada

| Metodo | Tipo | Descricao |
|--------|------|-----------|
| `solicitarDecisao` | Sincrono | Fluxo completo ate contrato |
| `consultarStatus` | Sincrono | Status de episodio |
| `extrairContrato` | Sincrono | Buscar contrato existente |

---

## 3. Requisitos Obrigatorios

### 3.1 Unica Saida = ContratoDeDecisao

```typescript
// CORRETO: Retorna apenas contrato
async solicitarDecisao(...): Promise<ContratoDeDecisao>

// PROIBIDO: Expor estados internos
async solicitarDecisao(...): Promise<{ episodio, decisao, contrato }> // NAO!
```

**Referencia**: [OrquestradorCognitivo.ts:727](../../incremento-1/orquestrador/OrquestradorCognitivo.ts#L727) - metodo `EmitirContrato`

### 3.2 Validacao de Protocolo Obrigatoria

Nenhuma decisao pode ser registrada sem protocolo VALIDADO:

```typescript
// Fluxo obrigatorio
const protocolo = await orq.ConstruirProtocoloDeDecisao(episodio_id, dados);
if (protocolo.estado !== EstadoProtocolo.VALIDADO) {
  throw new Error('Protocolo rejeitado: ' + protocolo.motivo_rejeicao);
}
const contrato = await orq.RegistrarDecisao(episodio_id, protocolo.id);
```

### 3.3 Sem Novos Atalhos

O Adapter NAO deve:
- Criar decisoes sem protocolo
- Modificar decisoes existentes
- Deletar episodios ou contratos
- Acessar repositorios diretamente
- Expor EventLog bruto

---

## 4. Payload do Contrato

### 4.1 ContratoDeDecisao (Saida Padrao)

```typescript
interface ContratoDeDecisao {
  id: string;                          // UUID do contrato
  episodio_id: string;                 // Referencia ao episodio
  decisao_id: string;                  // Referencia a decisao
  alternativa_autorizada: string;      // O que Bazari pode fazer
  limites_execucao: Limite[];          // Restricoes de execucao
  condicoes_obrigatorias: string[];    // Condicoes a cumprir
  observacao_minima_requerida: string[]; // O que observar
  data_emissao: Date;                  // Timestamp Libervia
  emitido_para: string;                // 'Bazari'
}
```

### 4.2 Metadados Adicionais para Execucao

O Adapter pode adicionar metadados de rastreio:

```typescript
interface ContratoComMetadados {
  contrato: ContratoDeDecisao;
  metadados: {
    request_id: string;           // ID da requisicao
    timestamp_solicitacao: Date;  // Quando Bazari pediu
    timestamp_emissao: Date;      // Quando contrato foi emitido
    versao_contrato: 'v1';        // Versao do formato
  };
}
```

---

## 5. Versionamento do Contrato

### 5.1 Estrategia

| Versao | Status | Mudancas |
|--------|--------|----------|
| v1 | Ativo | Formato inicial |
| v2 | Futuro | Campos adicionais (TBD) |

### 5.2 Compatibilidade

- Novos campos sao sempre opcionais
- Campos existentes nunca sao removidos
- Tipo `versao_contrato` indica formato

```typescript
// v1 -> v2 compativel
interface ContratoV2 extends ContratoDeDecisao {
  // Campos adicionais (opcionais)
  prioridade?: 'ALTA' | 'MEDIA' | 'BAIXA';
  prazo_maximo?: Date;
}
```

---

## 6. Seguranca

### 6.1 Autenticacao

Token estatico via ambiente:

```bash
export LIBERVIA_INTEGRATION_TOKEN="token-secreto-bazari"
```

```typescript
// No Adapter
if (process.env.LIBERVIA_INTEGRATION_TOKEN) {
  if (token !== process.env.LIBERVIA_INTEGRATION_TOKEN) {
    throw new UnauthorizedError('Token invalido');
  }
}
```

### 6.2 Rate Limiting (Futuro)

| Limite | Valor |
|--------|-------|
| Requisicoes/minuto | 100 |
| Requisicoes/hora | 1000 |

*Nota: Rate limiting sera implementado em incremento futuro*

### 6.3 Auditoria

Toda interacao via Adapter e logada:

```typescript
await this.logInteraction('BAZARI_SOLICITACAO', {
  request_id,
  situacao_id,
  timestamp
});
```

---

## 7. API do Adapter

### 7.1 Interface

```typescript
interface BazariAdapter {
  /**
   * Solicita decisao completa para uma situacao.
   * Executa fluxo completo: Situacao -> Episodio -> Protocolo -> Decisao -> Contrato
   * @returns APENAS ContratoDeDecisao (unica saida)
   */
  solicitarDecisao(
    situacaoData: SituacaoInput,
    protocoloData: DadosProtocoloInput,
    token?: string
  ): Promise<ContratoComMetadados>;

  /**
   * Consulta status de um episodio.
   * Retorna estado sem expor detalhes internos.
   */
  consultarStatus(
    episodio_id: string,
    token?: string
  ): Promise<StatusEpisodioPublico>;

  /**
   * Extrai contrato existente por episodio_id.
   * Retorna null se nao existir.
   */
  extrairContrato(
    episodio_id: string,
    token?: string
  ): Promise<ContratoDeDecisao | null>;
}
```

### 7.2 Tipos de Input

```typescript
interface SituacaoInput {
  dominio: string;
  contexto: string;
  objetivo: string;
  incertezas: string[];
  alternativas: Array<{
    descricao: string;
    riscos_associados: string[];
  }>;
  riscos: Array<{
    descricao: string;
    tipo: string;
    reversibilidade: string;
  }>;
  urgencia: string;
  capacidade_absorcao: string;
  consequencia_relevante: string;
  possibilidade_aprendizado: boolean;
  caso_uso_declarado: number;
}
```

### 7.3 Tipos de Resposta

```typescript
interface StatusEpisodioPublico {
  episodio_id: string;
  estado: 'CRIADO' | 'DECIDIDO' | 'EM_OBSERVACAO' | 'ENCERRADO';
  tem_contrato: boolean;
  data_criacao: Date;
  data_decisao?: Date;
}
```

---

## 8. Harness de Load Test

### 8.1 Objetivo

Validar comportamento sob carga:
- Apenas contratos sao retornados
- Estados permanecem consistentes
- EventLog mantem integridade

### 8.2 Metricas

| Metrica | Descricao |
|---------|-----------|
| tempo_medio | Tempo medio de resposta |
| p95 | Percentil 95 |
| p99 | Percentil 99 |
| taxa_sucesso | % de requisicoes com sucesso |
| taxa_contrato | % de requisicoes que retornaram contrato |

### 8.3 Validacoes Pos-Stress

1. `EventLog.verifyChain()` passa
2. `EventLog.replay()` e deterministico
3. Nenhum dado vazou alem de contratos

---

## 9. Limitacoes Conhecidas

| Limitacao | Motivo | Mitigacao Futura |
|-----------|--------|------------------|
| Token estatico | Simplicidade | Inc 8+: JWT |
| Sem rate limiting | Escopo | Inc 8+: Middleware |
| Harness interno | Sem API publica | Inc 8+: REST API |
| Sincrono apenas | Simplicidade | Inc 8+: Async/queue |

---

## 10. Checklist de Implementacao

- [ ] Criar `incremento-1/integracoes/bazari/Adapter.ts`
- [ ] Implementar `solicitarDecisao()` com fluxo completo
- [ ] Implementar `consultarStatus()` com estado publico
- [ ] Implementar `extrairContrato()` para busca
- [ ] Criar `scripts/bazari_load_test.ts`
- [ ] Criar `testes/incremento7.test.ts`
- [ ] Criar `docs/runbooks/garantias_integracao_bazari.md`
- [ ] Atualizar documentacao canonica
- [ ] Criar `docs/estado/semana6_interface_controlada.md`

---

*Documento criado em: 2025-12-23*
*Versao: 7.0*
