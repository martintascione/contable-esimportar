import { useEffect } from "react";

/**
 * Bloquea el scroll del <body> mientras el componente está montado.
 * Evita el "scroll chaining" (que al hacer scroll dentro de un modal, cuando llegás
 * al tope o al fondo, el scroll se propague al contenido detrás).
 *
 * Compensa el ancho de la scrollbar para que el fondo no salte al abrir/cerrar.
 * Soporta múltiples modales anidados: sólo el primero en montar guarda el estado.
 *
 * Uso:
 *   function MyModal() {
 *     useLockBodyScroll();
 *     return <div>...</div>;
 *   }
 */
export function useLockBodyScroll(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const body = document.body;
    // Contador global: si ya había un modal abierto, no volvemos a tocar los estilos base
    const w = window as any;
    w.__lockBodyScrollCount = (w.__lockBodyScrollCount ?? 0) + 1;

    if (w.__lockBodyScrollCount === 1) {
      w.__lockBodyScrollPrev = {
        overflow: body.style.overflow,
        paddingRight: body.style.paddingRight
      };
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      w.__lockBodyScrollCount = Math.max(0, (w.__lockBodyScrollCount ?? 1) - 1);
      if (w.__lockBodyScrollCount === 0 && w.__lockBodyScrollPrev) {
        body.style.overflow = w.__lockBodyScrollPrev.overflow;
        body.style.paddingRight = w.__lockBodyScrollPrev.paddingRight;
        delete w.__lockBodyScrollPrev;
      }
    };
  }, [enabled]);
}
