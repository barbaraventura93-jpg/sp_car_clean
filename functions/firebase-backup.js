'use strict';

// =====================================================================
// Backup diário do Firebase Realtime Database para o S3.
//
// Por que existe: o banco do site vive num projeto Firebase (Google), fora
// desta conta AWS. Em 08/11/2026 a chave de API desse projeto foi apagada e o
// acesso ao console foi perdido — o banco continuou servindo, mas sem console
// não há como exportar pelo painel nem publicar regras. O que ainda funciona é
// o `FIREBASE_DATABASE_SECRET`, que ignora as regras e dá leitura total.
//
// Esta função usa esse segredo para copiar o banco inteiro, todo dia, para um
// bucket privado nesta conta. Se o projeto Google for perdido de vez, o backup
// mais recente fica aqui.
//
// Dispara pelo EventBridge Scheduler (ver `scheduled_functions` em
// infra/api.tf). Não tem rota HTTP: nada externo pode chamá-la.
// =====================================================================

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);

// Nós que o banco precisa ter para o dump ser considerado íntegro. Se faltar
// qualquer um, é mais provável que a resposta seja erro/parcial do que o banco
// ter esvaziado — e gravar isso em cima de um backup bom é pior que não gravar.
const NOS_ESPERADOS = ['services', 'config', 'bookings'];
const TAMANHO_MINIMO = 2048; // bytes do JSON cru

exports.handler = async () => {
  const dbUrl = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const secret = process.env.FIREBASE_DATABASE_SECRET;
  const bucket = process.env.BACKUP_BUCKET;

  if (!dbUrl || !secret) {
    console.error('firebase-backup: FIREBASE_DATABASE_URL ou FIREBASE_DATABASE_SECRET ausente');
    return { ok: false, error: 'credenciais do Firebase ausentes' };
  }
  if (!bucket) {
    console.error('firebase-backup: BACKUP_BUCKET não configurado');
    return { ok: false, error: 'BACKUP_BUCKET ausente' };
  }

  // 1. Baixa o banco inteiro.
  let bruto;
  try {
    const resp = await fetch(`${dbUrl}/.json?auth=${encodeURIComponent(secret)}`);
    if (!resp.ok) {
      console.error(`firebase-backup: Firebase respondeu HTTP ${resp.status}`);
      return { ok: false, error: `firebase HTTP ${resp.status}` };
    }
    bruto = await resp.text();
  } catch (err) {
    console.error('firebase-backup: falha ao ler o Firebase:', err.message);
    return { ok: false, error: err.message };
  }

  // 2. Conferências de integridade — melhor falhar alto que gravar lixo.
  if (bruto.length < TAMANHO_MINIMO) {
    console.error(`firebase-backup: resposta pequena demais (${bruto.length} bytes), abortando`);
    return { ok: false, error: 'resposta suspeita (muito pequena)' };
  }
  let dados;
  try {
    dados = JSON.parse(bruto);
  } catch {
    console.error('firebase-backup: resposta não é JSON válido, abortando');
    return { ok: false, error: 'JSON inválido' };
  }
  if (!dados || typeof dados !== 'object') {
    console.error('firebase-backup: JSON não é um objeto, abortando');
    return { ok: false, error: 'JSON inesperado' };
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
