// Pequeño puente para que las vistas pidan volver a dibujar la pantalla actual.
export const bus = {
  rerender: () => {},
  go: (route) => (location.hash = '#/' + route),
};
