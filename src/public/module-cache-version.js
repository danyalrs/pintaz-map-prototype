/**
 * Shared ?v= query for public ES module imports so singletons (observation route state, etc.)
 * are not duplicated across differently-versioned import URLs.
 */
export const MODULE_CACHE_QUERY = 'osm-turn-lane-guidance-v2';
