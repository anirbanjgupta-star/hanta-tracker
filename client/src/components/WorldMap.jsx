import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';

const LEVEL_STYLE = {
  CRITICAL: { color: '#E63946', fillColor: '#E63946', radius: 12 },
  WARNING:  { color: '#F4A261', fillColor: '#F4A261', radius: 9 },
  ADVISORY: { color: '#00B4D8', fillColor: '#00B4D8', radius: 6 },
  WATCH:    { color: '#2EC4B6', fillColor: '#2EC4B6', radius: 4 },
};

export default function WorldMap({ cases = [], onCountryClick }) {
  return (
    <>
      <style>{`
        .map-wrap {
          flex: 1;
          min-width: 0;
          position: relative;
        }
        .map-wrap .leaflet-container {
          width: 100%;
          height: 100%;
          min-height: 400px;
          background: #080C10;
        }
        .leaflet-tooltip {
          background: var(--bg-surface) !important;
          border: 1px solid var(--border) !important;
          border-radius: 4px !important;
          color: var(--text-primary) !important;
          font-family: var(--font-body) !important;
          font-size: 12px !important;
          box-shadow: none !important;
          padding: 4px 8px !important;
        }
        .leaflet-tooltip-top:before { border-top-color: var(--border) !important; }
      `}</style>
      <div className="map-wrap">
        <MapContainer
          center={[20, 0]}
          zoom={2}
          minZoom={2}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
          attributionControl={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
          {cases
            .filter(c => c.lat != null && c.lng != null)
            .map(c => {
              const style = LEVEL_STYLE[c.alert_level] || LEVEL_STYLE.WATCH;
              return (
                <CircleMarker
                  key={c.location_id}
                  center={[c.lat, c.lng]}
                  radius={style.radius}
                  pathOptions={{
                    color: style.color,
                    fillColor: style.fillColor,
                    fillOpacity: 0.55,
                    weight: 2,
                  }}
                  eventHandlers={{
                    click: () => onCountryClick && onCountryClick(c.location_id),
                  }}
                >
                  <Tooltip>
                    <strong>{c.location_name || c.location_id}</strong>
                    <br />
                    Cases: {c.total_cases != null ? c.total_cases.toLocaleString() : '—'}
                  </Tooltip>
                </CircleMarker>
              );
            })}
        </MapContainer>
      </div>
    </>
  );
}
