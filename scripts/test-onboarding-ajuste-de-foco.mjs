// Criterio de keyboard-focus-390 (scripts/lib/onboarding-ajuste-de-foco.mjs) sobre mediciones
// sintéticas, sin navegador: con la regla de 192876f un radio sr-only se mueve y el caso falla;
// con abreTeclado no se mueve y pasa; los campos conservan su ajuste.
// node --test scripts/test-onboarding-ajuste-de-foco.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluarAjuste } from './lib/onboarding-ajuste-de-foco.mjs';

const ALTO_COMPLETO = { top: 64, bottom: 707, height: 643 };
const ALTO_CON_TECLADO = { top: 64, bottom: 423, height: 359 };
const vista = ({ scrollTop, control, bounds, esControl = true }) => ({ scrollTop, control, bounds, activo: { esControl } });

function radioSrOnly(scrollTopDespues) {
  // El radio sr-only no se mueve con el scroll de la lista: su rect sigue en la posición estática.
  const control = { top: 2470, bottom: 2471, height: 1 };
  return {
    caso: 'categoria-radio', tipo: 'control', modo: 'aislado', coincideReglaAnterior: true,
    antes: vista({ scrollTop: 1866, control, bounds: ALTO_COMPLETO }),
    despues: vista({ scrollTop: scrollTopDespues, control, bounds: ALTO_CON_TECLADO }),
    estable: vista({ scrollTop: scrollTopDespues, control, bounds: ALTO_CON_TECLADO }),
  };
}

function campo({ delta, controlAntes = { top: 400, bottom: 448, height: 48 } }) {
  const controlDespues = { top: controlAntes.top - delta, bottom: controlAntes.bottom - delta, height: controlAntes.height };
  return {
    caso: 'nombre-campo', tipo: 'campo', modo: 'aislado', coincideReglaAnterior: true,
    antes: vista({ scrollTop: 0, control: controlAntes, bounds: ALTO_COMPLETO }),
    despues: vista({ scrollTop: delta, control: controlDespues, bounds: ALTO_CON_TECLADO }),
    estable: vista({ scrollTop: delta, control: controlDespues, bounds: ALTO_CON_TECLADO }),
  };
}

test('con la regla de 192876f el radio sr-only se mueve: el caso discrimina y falla', () => {
  const resultado = evaluarAjuste(radioSrOnly(1866 + 2056));
  assert.equal(resultado.discrimina, true);
  assert.equal(resultado.delta, 2056);
  assert.deepEqual(resultado.fallas, ['categoria-radio: el ajuste movió 2056 px un control que no abre teclado']);
});

test('con abreTeclado el mismo radio no se mueve y el caso pasa', () => {
  const resultado = evaluarAjuste(radioSrOnly(1866));
  assert.equal(resultado.discrimina, true);
  assert.equal(resultado.delta, 0);
  assert.deepEqual(resultado.fallas, []);
});

test('un control que la regla vieja no movía, o que sigue a la vista, no discrimina', () => {
  const boton = { ...radioSrOnly(1866), caso: 'sugerencia-boton', coincideReglaAnterior: false };
  assert.equal(evaluarAjuste(boton).discrimina, false, 'button no estaba en el selector de 192876f');
  const visible = { top: 300, bottom: 380, height: 80 };
  const radioVisible = {
    ...radioSrOnly(0), caso: 'tipo-radio',
    antes: vista({ scrollTop: 0, control: visible, bounds: ALTO_COMPLETO }),
    despues: vista({ scrollTop: 0, control: visible, bounds: ALTO_CON_TECLADO }),
    estable: vista({ scrollTop: 0, control: visible, bounds: ALTO_CON_TECLADO }),
  };
  assert.equal(evaluarAjuste(radioVisible).discrimina, false, 'cabe sin ajuste');
  assert.deepEqual(evaluarAjuste(radioVisible).fallas, []);
});

test('un campo que el teclado taparía conserva su ajuste; sin ajuste falla', () => {
  // 448 > 423 - 8: sin moverse quedaría bajo el teclado.
  assert.deepEqual(evaluarAjuste(campo({ delta: 0 })).fallas, [
    'nombre-campo: el campo necesitaba ajuste y no se movió',
    'nombre-campo: el campo enfocado no quedó visible',
  ]);
  const ajustado = evaluarAjuste(campo({ delta: 33 }));
  assert.equal(ajustado.fueraDelMargen, true);
  assert.equal(ajustado.visibleDespues, true);
  assert.deepEqual(ajustado.fallas, []);
});

test('un campo que ya se ve no debe moverse', () => {
  const arriba = { top: 200, bottom: 248, height: 48 };
  assert.deepEqual(evaluarAjuste(campo({ delta: 0, controlAntes: arriba })).fallas, []);
  assert.deepEqual(evaluarAjuste(campo({ delta: 20, controlAntes: arriba })).fallas, ['nombre-campo: el campo se movió 20 px sin necesitarlo']);
});

test("el modo 'toque' solo registra: no aplica el criterio de B1", () => {
  const toque = { ...radioSrOnly(1866 + 2056), modo: 'toque' };
  assert.deepEqual(evaluarAjuste(toque).fallas, []);
  assert.equal(evaluarAjuste(toque).delta, 2056);
});

test('si el scroll sigue moviéndose después de medir, la medición no vale en ningún modo', () => {
  for (const modo of ['aislado', 'toque']) {
    const caso = { ...radioSrOnly(1866), modo };
    const movido = { ...caso, estable: { ...caso.estable, scrollTop: 1871 } };
    assert.deepEqual(evaluarAjuste(movido).fallas, ['categoria-radio: el scroll siguió moviéndose después de medir (5 px)'], modo);
  }
});

test("en 'aislado' el control tiene que haber recibido el foco", () => {
  const caso = radioSrOnly(1866);
  const sinFoco = { ...caso, antes: { ...caso.antes, activo: { esControl: false } } };
  assert.deepEqual(evaluarAjuste(sinFoco).fallas, ['categoria-radio: el control no recibió el foco']);
});

test('sin [data-onboarding-scroll] falla con un mensaje claro y sin números inventados', () => {
  const caso = radioSrOnly(1866);
  const sinScroller = { ...caso, despues: { ...caso.despues, scrollTop: null } };
  const resultado = evaluarAjuste(sinScroller);
  assert.equal(resultado.delta, null);
  assert.deepEqual(resultado.fallas, ['categoria-radio: no se encontró [data-onboarding-scroll]']);
});
