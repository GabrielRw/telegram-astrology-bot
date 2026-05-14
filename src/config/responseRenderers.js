const ROUTE_RESPONSE_RENDERERS = {
  current_sky_today: {
    id: 'monthly_transit_overview',
    description: 'Curated current-day/current-month transit overview from timeline data.'
  },
  today_transits_me: {
    id: 'monthly_transit_overview',
    description: 'Curated current-day/current-month transit overview from timeline data.'
  },
  month_ahead_transits: {
    id: 'monthly_transit_overview',
    description: 'Curated current-month transit overview from timeline data.'
  },
  monthly_transits_for_planet: {
    id: 'monthly_transit_planet_listing',
    description: 'Transit timeline filtered to one requested planet, with optional listing limits.'
  },
  transit_search_exact: {
    id: 'transit_search_result',
    description: 'Exact transit search result renderer for one transit planet, natal point, aspect set, and time range.'
  },
  relocation_recommendations: {
    id: 'relocation_report',
    description: 'Relocation recommendation renderer for astrocartography city/country results.'
  },
  relocation_city_check: {
    id: 'relocation_city_report',
    description: 'Single-city relocation renderer with lines, crossings, and city suitability.'
  },
  astrocartography_lines: {
    id: 'astrocartography_report',
    description: 'Astrocartography line renderer from map-line tool output.'
  },
  astrocartography_parans: {
    id: 'astrocartography_report',
    description: 'Astrocartography paran renderer from map-line tool output.'
  },
  secondary_progressions: {
    id: 'progressions_report',
    description: 'Secondary progressions renderer for a target year/date.'
  },
  secondary_progressions_exact_aspects: {
    id: 'progression_aspect_listing',
    description: 'Exact secondary progression aspect listing renderer.'
  },
  annual_profections: {
    id: 'profections_report',
    description: 'Annual profection renderer with year lord and house emphasis.'
  },
  solar_return: {
    id: 'solar_return_report',
    description: 'Solar return renderer for a selected year.'
  },
  planet_return: {
    id: 'planet_return_report',
    description: 'Planet return renderer for the requested body.'
  },
  ephemeris: {
    id: 'ephemeris_report',
    description: 'Ephemeris renderer for planetary positions, speeds, retrogrades, and aspects.'
  },
  personal_horoscope: {
    id: 'horoscope_report',
    description: 'Daily personal horoscope renderer.'
  },
  sign_horoscope: {
    id: 'horoscope_report',
    description: 'Daily sign horoscope renderer.'
  },
  synastry_summary: {
    id: 'synastry_report',
    description: 'Relationship compatibility/synastry renderer.'
  },
  synastry_detailed: {
    id: 'synastry_report',
    description: 'Relationship compatibility/synastry renderer.'
  },
  couples_horoscope: {
    id: 'synastry_report',
    description: 'Couples horoscope renderer.'
  },
  wedding_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  making_contracts_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  job_audition_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  purchase_property_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  purchase_car_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  move_into_new_home_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  starting_journey_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  legal_proceedings_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  physical_examination_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  },
  invest_money_election_search: {
    id: 'electional_results',
    description: 'Electional search result renderer for ranked timing windows.'
  }
};

function getRouteResponseRenderer(routeId) {
  return ROUTE_RESPONSE_RENDERERS[String(routeId || '').trim()] || null;
}

function getRouteResponseRendererShapeId(routeId) {
  return getRouteResponseRenderer(routeId)?.id || null;
}

function getResponseRendererDefinitions() {
  return Object.fromEntries(
    Object.entries(ROUTE_RESPONSE_RENDERERS).map(([routeId, renderer]) => [routeId, {
      routeId,
      ...renderer
    }])
  );
}

module.exports = {
  ROUTE_RESPONSE_RENDERERS,
  getResponseRendererDefinitions,
  getRouteResponseRenderer,
  getRouteResponseRendererShapeId
};
