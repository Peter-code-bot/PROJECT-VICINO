# Proposal: Selector de Radio de Búsqueda y Ajuste de Cerca de ti

## Problema
Actualmente la pantalla principal usa un radio de 25 km por defecto. Si el usuario no tiene la cookie de ubicación, o si la base de datos falla al cargar productos locales, la aplicación recae (fallback) en mostrar los 150 productos más recientes de toda la plataforma. Esto provoca que usuarios en ciudades como Villahermosa vean productos de Puebla.
Aunado a esto, los usuarios no tienen control sobre qué tan amplio o estricto quieren que sea su feed de productos.

## Solución
1. Añadir un menú desplegable en el modal de **Cambiar ubicación** para escoger el radio de búsqueda (1 km a 50 km).
2. Forzar que la sección "Cerca de ti" utilice estrictamente un radio hiperlocal fijo de 1 km.
3. Eliminar el fallback global en el feed principal: si el usuario configuró su ubicación, nunca se cargarán productos globales, solo los correspondientes al radio establecido.
