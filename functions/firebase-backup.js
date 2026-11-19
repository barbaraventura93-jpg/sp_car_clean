'use strict';

// =====================================================================
// Backup diário do banco para o S3.
//
// Nome mantido por ser o da função publicada (`sp-car-clean-firebase-backup`):
// renomear exigiria recriar o recurso e perderia o histórico de execuções. O
// banco é o DynamoDB desde 16/11/2026.
//
// Por que continua existindo, agora que a tabela tem recuperação ponto-a-ponto
// (PITR) de 35 dias: o PITR protege contra escrita errada, mas vive na mesma
// conta e no mesmo serviço. Este backup é um arquivo que a dona pode baixar,
// ler e levar para outro lugar — e foi exatamente um backup assim, de 09/11,
// que trouxe os dados de volta quando o Firebase foi excluído.
//
// O formato é `{ no: { chave: valor } }`, o MESMO que
// scripts/importar-para-dynamodb.js consome. Restaurar é rodar o importador
// sobre o arquivo — um backup que só ele mesmo entende não restaura nada.
//
// Dispara pelo EventBridge Scheduler (ver `scheduled_functions` em
// infra/api.tf). Não tem rota HTTP: nada externo pode chamá-la.
// =====================================================================

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const { exportarTudo } = require('./lib/core/store');

// Nós que o banco precisa ter para o dump ser considerado íntegro. Se faltar
// qualquer um, é mais provável que a resposta seja erro/parcial do que o banco
// ter esvaziado — e gravar isso em cima de um backup bom é pior que não gravar.
const NOS_ESPERADOS = ['services', 'config', 'bookings'];
const TAMANHO_MINIMO = 2048; // bytes do JSON cru

exports.handler = async () => {
  const bucket = process.env.BACKUP_BUCKET;

  if (!bucket) {
    console.error('firebase-backup: BACKUP_BUCKET não configurado');
    return { ok: false, error: 'BACKUP_BUCKET ausente' };
  }

  // 1. Lê a tabela inteira, já no formato do backup.
  let dados, lidos, ignorados;
  try {
    const r = await exportarTudo();
    dados = r.dados;
    lidos = r.itens;
    ignorados = r.ignorados;
  } catch (err) {
    console.error('firebase-backup: falha ao ler a tabela:', err.message);
    return { ok: false, error: err.message };
  }

  // Item com nó que o mapeamento não conhece não entra no arquivo. Não pode
  // passar em silêncio: é dado que o backup não cobre.
  if (ignorados) {
    console.error(`firebase-backup: ${ignorados} item(ns) fora do mapeamento — NÃO entraram no backup`);
  }

  const bruto = JSON.stringify(dados);

  // 2. Conferências de integridade — melhor falhar alto que gravar lixo.
  if (bruto.length < TAMANHO_MINIMO) {
    console.error(`firebase-backup: exportação pequena demais (${bruto.length} bytes), abortando`);
    return { ok: false, error: 'exportação suspeita (muito pequena)' };
  }
  const faltando = NOS_ESPERADOS.filter((n) => !(n in dados));
  if (faltando.length) {
    console.error(`firebase-backup: nós ausentes (${faltando.join(', ')}), abortando`);
    return { ok: false, error: `nós ausentes: ${faltando.join(', ')}` };
  }

  const contagem = {};
  for (const [k, v] of Object.entries(dados)) {
    contagem[k] = v && typeof v === 'object' ? Object.keys(v).length : 1;
  }

  // 3. Compacta e grava com chave por data (um objeto por dia, sem sobrescrever
  //    histórico: a hora entra na chave).
  const agora = new Date();
  const iso = agora.toISOString().replace(/[:.]/g, '-');
  const key = `firebase/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/firebase-${iso}.json.gz`;

  try {
    const corpo = await gzip(Buffer.from(bruto, 'utf8'));
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({});
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: corpo,
        ContentType: 'application/json',
        ContentEncoding: 'gzip',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'no-de-primeiro-nivel': String(Object.keys(dados).length),
          'bytes-originais': String(bruto.length),
          'itens-lidos': String(lidos),
          'itens-ignorados': String(ignorados),
        },
      })
    );
    console.log(
      `firebase-backup: ok — s3://${bucket}/${key} ` +
        `(${bruto.length} bytes crus, ${corpo.length} comprimidos, ` +
        `${Object.keys(dados).length} nós) ${JSON.stringify(contagem)}`
    );
    return {
      ok: true,
      bucket,
      key,
      bytesOriginais: bruto.length,
      bytesComprimidos: corpo.length,
      nos: contagem,
    };
  } catch (err) {
    console.error('firebase-backup: falha ao gravar no S3:', err.message);
    return { ok: false, error: err.message };
  }
};
