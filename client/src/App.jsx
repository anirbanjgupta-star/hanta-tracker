import './tokens.css';
import { useCallback } from 'react';
import { useOutbreakData } from './hooks/useOutbreakData';
import { useDrillDown } from './hooks/useDrillDown';
import { useNews } from './hooks/useNews';
import { useGuidelines } from './hooks/useGuidelines';

import DisclaimerBanner from './components/DisclaimerBanner';
import Header from './components/Header';
import WorldMap from './components/WorldMap';
import DetailPanel from './components/DetailPanel';
import BottomPanel from './components/BottomPanel';
import StatusBar from './components/StatusBar';

export default function App() {
  const { cases, meta, loading } = useOutbreakData();
  const { selected, selectLocation, clearSelection } = useDrillDown();
  const { articles, filter: newsFilter, setFilter: setNewsFilter } = useNews();
  const { guidelines } = useGuidelines();

  const knownCases = cases.filter(c => c.total_cases != null);
  const globalCases = knownCases.length ? knownCases.reduce((s, c) => s + c.total_cases, 0) : null;
  const knownFatalities = cases.filter(c => c.fatalities != null);
  const globalFatalities = knownFatalities.length ? knownFatalities.reduce((s, c) => s + c.fatalities, 0) : null;
  const flaggedCount = articles.filter(a => a.is_disputed || a.is_unverified_claim).length;

  const handleCountryClick = useCallback((locationId) => {
    const found = cases.find(c => c.location_id === locationId);
    selectLocation(locationId, found?.location_name || locationId);
  }, [cases, selectLocation]);

  const handleDetailSelect = useCallback((locationId) => {
    if (locationId == null) { clearSelection(); return; }
    const found = cases.find(c => c.location_id === locationId);
    selectLocation(locationId, found?.location_name || locationId);
  }, [cases, selectLocation, clearSelection]);

  const handleViewFlagged = useCallback(() => {
    setNewsFilter('flagged');
  }, [setNewsFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <DisclaimerBanner />

      <Header
        meta={meta}
        globalCases={loading ? null : globalCases}
        globalFatalities={loading ? null : globalFatalities}
        cases={cases}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <WorldMap cases={cases} onCountryClick={handleCountryClick} />
        <DetailPanel
          selected={selected}
          cases={cases}
          onSelect={handleDetailSelect}
        />
      </div>

      <BottomPanel
        articles={articles}
        guidelines={guidelines}
        flaggedCount={flaggedCount}
        meta={meta}
        onViewFlagged={handleViewFlagged}
        activeNewsFilter={newsFilter}
        onNewsFilterChange={setNewsFilter}
      />

      <StatusBar meta={meta} />
    </div>
  );
}
