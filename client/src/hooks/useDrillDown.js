import { useState, useCallback } from 'react';

export function useDrillDown() {
  const [selected, setSelected] = useState(null);

  const selectLocation = useCallback((locationId, locationName) => {
    setSelected({ locationId, locationName });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
  }, []);

  return { selected, selectLocation, clearSelection };
}
