export const NM_GRT_STARTER_METADATA = {
  generatedAt: '2026-04-18',
  source: 'https://grt.edacnm.org/api/by_address',
  notes: 'Starter New Mexico GRT reference locations harvested from the public EDAC API. Rates are percentages and should be refreshed over time.'
};

export const NM_GRT_STARTER_LOCATIONS = [
  {
    city: 'Albuquerque',
    cityAliases: ['ALBUQUERQUE'],
    county: 'Bernalillo',
    postalCodes: ['87193'],
    locationCode: '02-100',
    effectiveRate: 0.07625,
    source: 'Intuit',
    sampleAddress: {
      street_number: '65432',
      street_name: 'PO BOX',
      city: 'Albuquerque',
      zipcode: '87193',
      county: 'Bernalillo'
    }
  },
  {
    city: 'Santa Fe',
    cityAliases: ['SANTA FE'],
    county: 'Santa Fe',
    postalCodes: ['87501'],
    locationCode: '01-123',
    effectiveRate: 0.081875,
    source: 'Intuit',
    sampleAddress: {
      street_number: '1',
      street_name: 'Mansion',
      street_suffix: 'Dr',
      city: 'Santa Fe',
      zipcode: '87501',
      county: 'Santa Fe'
    }
  },
  {
    city: 'Los Alamos',
    cityAliases: ['LOS ALAMOS'],
    county: 'Los Alamos',
    postalCodes: ['87544'],
    locationCode: '32-032',
    effectiveRate: 0.070625,
    source: 'Intuit',
    sampleAddress: {
      street_number: '1',
      street_name: 'PO BOX',
      city: 'Los Alamos',
      zipcode: '87544',
      county: 'Los Alamos'
    }
  },
  {
    city: 'Espanola',
    cityAliases: ['ESPANOLA', 'ESPANOLA', 'ESPAÑOLA'],
    county: 'Rio Arriba',
    postalCodes: ['87532'],
    locationCode: '17-215',
    effectiveRate: 0.086875,
    source: 'Intuit',
    sampleAddress: {
      street_number: '1',
      street_name: 'PO BOX',
      city: 'Española',
      zipcode: '87532',
      county: 'Rio Arriba'
    }
  },
  {
    city: 'Taos',
    cityAliases: ['TAOS'],
    county: 'Taos',
    postalCodes: ['87571'],
    locationCode: '20-126',
    effectiveRate: 0.09175,
    source: 'Intuit',
    sampleAddress: {
      street_number: '1',
      street_name: 'PO BOX',
      city: 'Taos',
      zipcode: '87571',
      county: 'Taos'
    }
  }
];
