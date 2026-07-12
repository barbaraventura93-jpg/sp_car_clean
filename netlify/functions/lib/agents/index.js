'use strict';

// Barrel file: mapeia agentId → módulo do agente.
// Requires estáticos (em vez de require(`./lib/agents/${agentId}`) dinâmico) para que o
// empacotador de Netlify Functions consiga resolver as dependências no build.
// Agentes ainda não implementados (ver DEFAULTS em lib/core/config.js) simplesmente
// não aparecem aqui — os chamadores tratam isso como "módulo não encontrado".
module.exports = {
  ping:       require('./ping'),
  relatorio:  require('./relatorio'),
  reativacao: require('./reativacao'),
  agenda:     require('./agenda'),
  upsell:     require('./upsell'),
};
