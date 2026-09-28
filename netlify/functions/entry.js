'use strict';

// Ponto de entrada único das Lambdas na AWS.
// Cada Lambda define FN_TARGET (ex.: "ai", "booking-status") e usa este arquivo
// como handler (entry.handler). Aqui carregamos os segredos do SSM e delegamos
// para o handler real da função, que continua no formato Netlify — sem precisar
// reescrever nenhuma função.

const { loadSecrets } = require('./lib/core/secrets');

const TARGET = process.env.FN_TARGET;
let inner;

exports.handler = async (event, context) => {
  await loadSecrets();
  if (!inner) {
    if (!TARGET) throw new Error('FN_TARGET não definido para esta Lambda');
    inner = require('./' + TARGET).handler;
  }
  return inner(event, context);
};
