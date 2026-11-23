'use strict';

const $ = (id) => document.getElementById(id);
const atlas = $('atlas');
const detail = $('painting');
const heading = $('places-title');
const places = $('places-list');
const status = $('map-status');
const worldBounds = [[-60, -179], [78, 179]];
const worldRoute = '#atlas-view';
const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let map;
let artworks = [];
let groups = [];
let returningFocus = null;
let scrollPosition = 0;
let worldMode = true;
let loadError = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function title(item) {
  return item.title || item.displayLabel || (item.sample ? 'Sample artwork ' + item.id.split('-').at(-1) : 'Title pending');
}

function locationText(item) {
  return [item.place, item.neighborhood, item.city, item.country].filter(Boolean).join(', ') || 'Location pending';
}

function validCoordinates(item) {
  return Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 85.05112878
    && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180;
}

function groupBy(items, keyOf) {
  const result = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  }
  return [...result.values()];
}

function makeGroups(items) {
  return groupBy(items.filter(validCoordinates), (item) => [
    item.country, item.city, item.place || item.neighborhood || [item.latitude, item.longitude].join(',')
  ].map((part) => String(part ?? '').trim().toLowerCase()).join('|')).map((records) => ({
    records,
    point: [records[0].latitude, records[0].longitude],
    label: records[0].place || records[0].neighborhood || records[0].city || records[0].country || 'Location pending'
  }));
}

function artworkHref(item) {
  return '#painting/' + encodeURIComponent(item.id);
}

function row(tag, name, subtitle, count) {
  const node = element(tag, '', 'place');
  if (tag === 'button') node.type = 'button';
  const label = element('span');
  label.append(element('span', name, 'place-name'));
  if (subtitle) label.append(element('small', subtitle));
  node.append(label);
  if (count) node.append(element('span', count, 'place-count'));
  return node;
}

function artworkRow(item) {
  const link = row('a', title(item), item.sample ? 'Sample record' : locationText(item));
  link.href = artworkHref(item);
  if (item.thumbnail && item.image === item.originalImage) {
    const thumbnail = element('img', '', 'artwork-thumb');
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    thumbnail.src = item.thumbnail;
    link.prepend(thumbnail);
  }
  return link;
}

function countText(count) {
  return count + (count === 1 ? ' work' : ' works');
}

function focusGroups(selected) {
  if (!map) {
    showPlace(selected.flatMap((group) => group.records), selected[0].label);
    return;
  }
  worldMode = false;
  const bounds = L.latLngBounds(selected.map((group) => group.point));
  map.flyToBounds(bounds, {padding: [65, 65], maxZoom: 13, animate: motion, duration: .75});
}

function renderPlaces() {
  $('places-context').textContent = 'Explore the atlas';
  heading.textContent = 'Places';
  places.replaceChildren();
  const cities = groupBy(groups, ({records: [item]}) => [item.country, item.city || item.place || item.neighborhood].join('|'));
  cities.sort((a, b) => {
    const label = (city) => city[0].records[0].city || city[0].label;
    return Number(label(b) === 'Riyadh') - Number(label(a) === 'Riyadh') || label(a).localeCompare(label(b));
  });
  for (const city of cities) {
    const [first] = city[0].records;
    const name = first.city || city[0].label;
    const records = city.flatMap((group) => group.records);
    const button = row('button', name, first.country, countText(records.length));
    button.addEventListener('click', () => {
      focusGroups(city);
      showPlace(records, name, city);
      heading.focus({preventScroll: true});
    });
    places.append(button);
  }
  for (const item of artworks.filter((item) => !validCoordinates(item))) places.append(artworkRow(item));
  if (!artworks.length) places.append(element('p', loadError ? 'Please reload to try again.' : 'Paintings will appear here when they are added.'));
}

function showPlace(records, name, selectedGroups = []) {
  $('places-context').textContent = 'Selected location';
  heading.textContent = name;
  places.replaceChildren();
  if (selectedGroups.length > 1) {
    for (const group of selectedGroups) {
      const button = row('button', group.label, '', countText(group.records.length));
      button.addEventListener('click', () => {
        focusGroups([group]);
        showPlace(group.records, group.label);
        heading.focus({preventScroll: true});
      });
      places.append(button);
    }
  } else {
    for (const item of records) places.append(artworkRow(item));
  }
  const back = row('button', 'All places');
  back.addEventListener('click', () => {
    renderPlaces();
    heading.focus({preventScroll: true});
  });
  places.append(back);
}

function resetMap() {
  if (map) map.fitBounds(worldBounds, {padding: [12, 12], animate: false});
  worldMode = true;
  renderPlaces();
}

function displayDate(value) {
  if (!value) return 'Date pending';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z');
  return parsed && Number.isFinite(parsed.valueOf())
    ? new Intl.DateTimeFormat('en', {dateStyle: 'long', timeZone: 'UTC'}).format(parsed)
    : value;
}

function placeholder() {
  const frame = element('div', '', 'empty-art');
  frame.append(element('span', 'Painting photograph pending'));
  return frame;
}

function showDetail(item) {
  if (!atlas.hidden) {
    returningFocus = document.activeElement;
    scrollPosition = window.scrollY;
  }
  atlas.hidden = true;
  detail.hidden = false;
  const back = element('a', 'Return to map', 'back');
  back.href = worldRoute;
  detail.replaceChildren(back);
  const layout = element('div', '', 'detail-layout');
  const figure = element('figure', '', 'detail-image');
  const copy = element('div', '', 'detail-copy');
  const name = item ? title(item) : 'Painting unavailable';
  const headline = element('h1', name);
  headline.id = 'painting-title';
  headline.tabIndex = -1;
  if (item) {
    if (item.image) {
      const img = element('img');
      img.alt = item.imageAlt || name;
      img.decoding = 'async';
      if (item.imageSrcset && item.image === item.originalImage) {
        img.srcset = item.imageSrcset;
        img.sizes = '(max-width: 740px) 90vw, 60vw';
      }
      img.addEventListener('error', () => figure.replaceChildren(placeholder()), {once: true});
      img.src = item.image.startsWith('/images/') ? '.' + item.image : item.image;
      figure.append(img);
    } else {
      figure.append(placeholder());
    }
    copy.append(element('p', item.sample ? 'Sample record' : item.title ? 'Painting' : 'Title pending', 'eyebrow'));
  }
  copy.append(headline);
  if (item) {
    const facts = element('dl');
    facts.append(element('dt', 'Location'), element('dd', locationText(item)),
      element('dt', 'Date painted'), element('dd', displayDate(item.datePainted)));
    copy.append(facts, element('p', item.description || 'Personal memory pending'));
    if (item.notes) copy.append(element('p', item.notes));
    if (item.sample) copy.append(element('p', 'Sample map location. The artwork and its details await confirmation.', 'sample-note'));
    layout.append(figure);
  }
  layout.append(copy);
  detail.append(layout);
  document.title = name + ' · Myrnan - Places in Paint';
  window.scrollTo(0, 0);
  headline.focus({preventScroll: true});
}

function route() {
  if (location.hash.startsWith('#painting/')) {
    let id;
    try { id = decodeURIComponent(location.hash.slice(10)); } catch { id = null; }
    showDetail(artworks.find((item) => item.id === id));
    return;
  }
  const wasDetail = atlas.hidden;
  detail.hidden = true;
  atlas.hidden = false;
  document.title = 'Myrnan - Places in Paint';
  if (map && wasDetail) {
    map.invalidateSize({pan: false});
    if (worldMode) map.fitBounds(worldBounds, {padding: [12, 12]});
  }
  if (wasDetail) {
    window.scrollTo(0, scrollPosition);
    if (returningFocus && returningFocus !== document.body && returningFocus.isConnected) {
      returningFocus.focus({preventScroll: true});
    } else {
      heading.focus({preventScroll: true});
    }
  }
}

function markerIcon(count, isCluster) {
  const kind = isCluster ? 'cluster' : count > 1 ? 'multiple' : 'single';
  const size = isCluster ? 44 : 36;
  return L.divIcon({
    className: 'map-marker',
    html: '<span aria-hidden="true" class="marker-core ' + kind + '">' + (count > 1 ? count : '') + '</span>',
    iconSize: [size, size]
  });
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Unable to load ' + path);
  return response.json();
}

function notice(message) {
  status.textContent = message;
  status.hidden = !message;
}

async function initMap() {
  map = L.map('map', {
    minZoom: 0, maxZoom: 19, zoomSnap: .25, zoomDelta: 1,
    scrollWheelZoom: false, maxBounds: [[-85, -225], [85, 225]],
    attributionControl: true, maxBoundsViscosity: .75
  });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com/">Leaflet</a>');
  map.fitBounds(worldBounds, {padding: [12, 12]});
  map.on('dragstart zoomstart', () => { worldMode = false; });
  new ResizeObserver(() => {
    if (atlas.hidden) return;
    map.invalidateSize({pan: false});
    if (worldMode) {
      map.fitBounds(worldBounds, {padding: [12, 12], animate: false});
      worldMode = true;
    }
  }).observe($('map'));

  const clusters = L.markerClusterGroup({
    maxClusterRadius: (zoom) => zoom < 8 ? 57 : 36,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: false,
    animate: motion,
    iconCreateFunction: (cluster) => markerIcon(
      cluster.getAllChildMarkers().reduce((count, marker) => count + marker.options.artworkCount, 0), true)
  });
  clusters.on('clusterclick', (event) => {
    const selected = event.layer.getAllChildMarkers().map((marker) => marker.options.group);
    const bounds = event.layer.getBounds();
    const nextZoom = Math.min(19, map.getBoundsZoom(bounds, false, [130, 130]));
    if (nextZoom <= map.getZoom() || bounds.getNorthEast().equals(bounds.getSouthWest())) {
      showPlace(selected.flatMap((group) => group.records), 'Nearby locations');
      heading.focus({preventScroll: true});
    } else {
      worldMode = false;
      map.flyToBounds(bounds, {padding: [65, 65], maxZoom: 19, animate: motion, duration: .75});
    }
  });
  clusters.on('animationend layeradd', () => {
    clusters.eachLayer((marker) => {
      const parent = clusters.getVisibleParent(marker);
      if (parent && parent !== marker) {
        const icon = parent.getElement();
        if (icon) icon.setAttribute('aria-label', 'Zoom to ' + parent.getChildCount() + ' locations');
      }
    });
  });
  for (const group of groups) {
    const name = group.label + ', ' + countText(group.records.length);
    const marker = L.marker(group.point, {
      icon: markerIcon(group.records.length, false), title: name,
      artworkCount: group.records.length, group
    });
    marker.on('add', () => {
      const icon = marker.getElement();
      if (!icon) return;
      icon.setAttribute('aria-label', name);
      icon.setAttribute('role', 'button');
      icon.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        marker.fire('click');
      };
    });
    marker.on('click', () => {
      if (group.records.length === 1) {
        location.hash = artworkHref(group.records[0]);
      } else {
        showPlace(group.records, group.label);
        heading.focus({preventScroll: true});
        if (matchMedia('(max-width: 740px)').matches) heading.scrollIntoView({block: 'nearest'});
      }
    });
    clusters.addLayer(marker);
  }
  map.addLayer(clusters);

  try {
    const [topology, config] = await Promise.all([json('assets/world.json'), json('map-config.json')]);
    L.geoJSON(topojson.feature(topology, topology.objects.countries), {
      interactive: false,
      style: {color: '#718f9b', weight: .85, opacity: .86, fillColor: '#d9e4df', fillOpacity: 1},
      attribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>'
    }).addTo(map);
    if (config.tileUrl) {
      map.createPane('streets').style.zIndex = '410';
      const tiles = L.tileLayer(config.tileUrl, {
        minZoom: 7, maxZoom: 19, attribution: config.tileAttribution, noWrap: true,
        className: 'street-tiles', pane: 'streets'
      });
      let tileFailed = false;
      const syncTiles = () => {
        if (map.getZoom() >= 7) {
          if (!map.hasLayer(tiles)) {
            tileFailed = false;
            tiles.addTo(map);
          }
        } else if (map.hasLayer(tiles)) {
          tiles.remove();
          if (tileFailed) notice('');
        }
      };
      tiles.on('loading', () => { tileFailed = false; });
      tiles.on('tileerror', () => { tileFailed = true; notice('Some street details are unavailable. Artwork locations remain accessible.'); });
      tiles.on('load', () => { if (!tileFailed && !loadError) notice(''); });
      map.on('zoomend', syncTiles);
      syncTiles();
    }
  } catch {
    notice('The base map could not load. You can still explore artwork locations.');
  }
}

async function start() {
  try {
    const catalog = await json('artworks.json');
    artworks = catalog.paintings;
    if (!Array.isArray(artworks)) throw new Error('Invalid artwork catalog');
    groups = makeGroups(artworks);
  } catch {
    loadError = true;
    artworks = [];
    notice('The artwork catalog could not load.');
  }
  $('sample-note').hidden = !artworks.some((item) => item.sample);
  renderPlaces();
  $('world').addEventListener('click', resetMap);
  addEventListener('hashchange', route);
  try {
    await initMap();
  } catch {
    map = null;
    notice('The map could not start. You can still explore the places list.');
  }
  route();
}

start();
