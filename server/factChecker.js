const VERIFIED_CLAIMS = [
  {
    claim: 'hantavirus_not_person_to_person',
    description: 'Hantavirus does not spread person-to-person (except Andes virus, limited cases)',
    disputeKeywords: [
      'hantavirus spreads between people',
      'hantavirus is contagious',
      'hantavirus transmitted human to human',
      'hantavirus airborne between humans'
    ],
    source: 'CDC',
    sourceUrl: 'https://www.cdc.gov/hantavirus/transmission/index.html'
  },
  {
    claim: 'no_vaccine_exists',
    description: 'There is no approved vaccine for Hantavirus as of 2025',
    disputeKeywords: [
      'hantavirus vaccine approved',
      'hantavirus cure found',
      'hantavirus treatment discovered'
    ],
    source: 'WHO',
    sourceUrl: 'https://www.who.int/news-room/fact-sheets/detail/hantavirus-disease'
  },
  {
    claim: 'rodent_is_primary_vector',
    description: 'Rodents are the primary transmission vector',
    disputeKeywords: [
      'hantavirus spreads through food',
      'hantavirus spreads through water',
      'hantavirus mosquito',
      'hantavirus insect'
    ],
    source: 'CDC',
    sourceUrl: 'https://www.cdc.gov/hantavirus/transmission/index.html'
  }
];

/**
 * Check an article object (must have title and/or summary/raw_text) against known claims.
 * Returns { is_disputed: 0|1, dispute_reason: string|null }
 */
export function checkArticle(article) {
  const text = [
    article.title || '',
    article.summary || '',
    article.raw_text || '',
    article.description || '',
  ].join(' ').toLowerCase();

  for (const claim of VERIFIED_CLAIMS) {
    for (const keyword of claim.disputeKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          is_disputed: 1,
          dispute_reason: `Disputes verified claim "${claim.claim}": ${claim.description}. Source: ${claim.source} (${claim.sourceUrl})`,
        };
      }
    }
  }

  return { is_disputed: 0, dispute_reason: null };
}

export default { checkArticle };
