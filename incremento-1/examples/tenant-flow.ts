/**
 * EXEMPLO: Fluxo completo de decisão
 *
 * Demonstra o fluxo de criar decisão, consultar episódio e registrar consequência.
 * Este exemplo requer um tenant existente com token público.
 *
 * Uso:
 *   ADMIN_TOKEN=xxx TENANT_ID=xxx PUBLIC_TOKEN=xxx npx ts-node examples/tenant-flow.ts
 */

import { createLiberviaClient, LiberviaError, DecisaoInput } from '../sdk/src';

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const adminToken = process.env.ADMIN_TOKEN || 'admin-token-dev';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LIBERVIA SDK - Fluxo Completo de Decisão');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Base URL: ${baseUrl}`);
  console.log('');

  // Cliente admin para setup
  const adminClient = createLiberviaClient({
    baseUrl,
    token: adminToken
  });

  try {
    // 1. Criar tenant de teste
    const tenantId = `flow-test-${Date.now()}`;
    console.log('📁 Criando tenant de teste...');
    const tenant = await adminClient.admin.createTenant({
      id: tenantId,
      name: 'Flow Test Tenant'
    });
    console.log(`   Tenant: ${tenant.id}`);

    // 2. Criar chave pública
    console.log('🔑 Criando chave pública...');
    const publicKey = await adminClient.admin.createKey(tenantId, {
      role: 'public',
      description: 'Public key for flow test'
    });
    console.log(`   Token: ${publicKey.token.substring(0, 20)}...`);
    console.log('');

    // 3. Cliente público para operações cognitivas
    const publicClient = createLiberviaClient({
      baseUrl,
      token: publicKey.token,
      tenantId
    });

    // 4. Criar decisão
    console.log('📝 Criando decisão...');
    const decisaoInput: DecisaoInput = {
      situacao: {
        dominio: 'financeiro',
        contexto: 'Análise de investimento em nova tecnologia',
        objetivo: 'Decidir sobre alocação de recursos',
        incertezas: [
          'Retorno incerto do investimento',
          'Risco de obsolescência'
        ],
        alternativas: [
          {
            descricao: 'Investir 100%',
            riscos_associados: ['Alto risco financeiro']
          },
          {
            descricao: 'Investir 50%',
            riscos_associados: ['Risco moderado']
          },
          {
            descricao: 'Não investir',
            riscos_associados: ['Perda de oportunidade']
          }
        ],
        riscos: [
          {
            descricao: 'Perda financeira',
            tipo: 'financeiro',
            reversibilidade: 'parcial'
          }
        ],
        urgencia: 'media',
        capacidade_absorcao: 'alta',
        consequencia_relevante: 'Impacto no orçamento anual',
        possibilidade_aprendizado: true,
        caso_uso_declarado: 1
      },
      protocolo: {
        criterios_minimos: [
          'ROI mínimo de 10%',
          'Prazo máximo de 2 anos'
        ],
        riscos_considerados: ['Perda financeira'],
        limites_definidos: [
          {
            tipo: 'financeiro',
            valor: '100000',
            descricao: 'Limite máximo de investimento'
          }
        ],
        perfil_risco: 'moderado',
        alternativas_avaliadas: ['Investir 100%', 'Investir 50%', 'Não investir'],
        alternativa_escolhida: 'Investir 50%'
      }
    };

    const decisao = await publicClient.public.criarDecisao(decisaoInput);
    console.log(`   Episódio ID: ${decisao.episodio_id}`);
    console.log(`   Contrato ID: ${decisao.contrato.id}`);
    console.log(`   Alternativa: ${decisao.contrato.alternativa_escolhida}`);
    console.log('');

    // 5. Consultar status do episódio
    console.log('🔍 Consultando episódio...');
    const episodio = await publicClient.public.getEpisodio(decisao.episodio_id);
    console.log(`   Último evento: ${episodio.ultimo_evento}`);
    console.log(`   Total eventos: ${episodio.total_eventos}`);
    console.log(`   Tem contrato: ${episodio.tem_contrato}`);
    console.log('');

    // 6. Iniciar observação
    console.log('👀 Iniciando observação...');
    await publicClient.public.iniciarObservacao(decisao.episodio_id);
    console.log('   Observação iniciada');
    console.log('');

    // 7. Listar eventos
    console.log('📋 Listando eventos...');
    const eventos = await publicClient.public.listarEventos({ limit: 5 });
    console.log(`   Total: ${eventos.total}`);
    for (const e of eventos.eventos.slice(0, 3)) {
      console.log(`   - ${e.evento}: ${e.entidade}`);
    }
    console.log('');

    // 8. Consultar dashboard via cliente admin
    console.log('📊 Consultando dashboard...');
    const dashboard = await adminClient.query.getDashboard(tenantId);
    console.log(`   Mandates: ${dashboard.mandates.total}`);
    console.log(`   Reviews: ${dashboard.reviews.OPEN} open`);
    console.log(`   Recent events: ${dashboard.recentEvents.length}`);
    console.log('');

    // 9. Cleanup
    console.log('🗑️  Removendo tenant de teste...');
    await adminClient.admin.deleteTenant(tenantId);
    console.log('   Tenant removido');
    console.log('');

    console.log('✅ Fluxo completo executado com sucesso!');
  } catch (error) {
    if (error instanceof LiberviaError) {
      console.error(`❌ Erro ${error.status}: ${error.message}`);
      console.error(`   Code: ${error.code}`);
      console.error(`   Request ID: ${error.requestId}`);
    } else {
      console.error('❌ Erro inesperado:', error);
    }
    process.exit(1);
  }
}

main();
