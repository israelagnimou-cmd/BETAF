import './styles.css';
import './settings.css';
import attestationSealUrl from './assets/attestation-seal.jpg';
import betafLogoUrl from './assets/betaf-logo.png';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth';

const services = ['Topographie', 'Foncier', 'Lotissements', 'VRD', 'Génie civil', 'Bâtiment', 'Aménagement foncier', 'Construction', 'Cartographie par drone', 'Implantation de chantier', 'Suivi de chantier'];
const villageAttestationType = 'Attestation d’attribution villageoise';
const cessionAttestationType = 'Attestation de cession';
const saleAttestationType = 'Attestation de vente';
const documentTypes = ['Attestation de propriété', villageAttestationType, cessionAttestationType, saleAttestationType, 'Plan topographique', 'Devis estimatif', 'Rapport de suivi de chantier', 'Procès-verbal d’implantation'];
const savedDocumentTypes = JSON.parse(localStorage.getItem('betaf-document-types') || 'null');
const savedDocumentTypeTemplates = JSON.parse(localStorage.getItem('betaf-document-type-templates') || 'null');
const normalizedDocumentType = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
const isVillageAttestation = value => normalizedDocumentType(value) === normalizedDocumentType(villageAttestationType);
const isCessionAttestation = value => normalizedDocumentType(value) === normalizedDocumentType(cessionAttestationType);
const isSaleAttestation = value => normalizedDocumentType(value) === normalizedDocumentType(saleAttestationType);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attestationValue = (attestation, field, fallback = '') => escapeHtml(attestation?.[field] || fallback || '');
const clientFullName = client => [client?.prenom, client?.nom].filter(Boolean).join(' ');
const clientAttestationDefaults = client => ({
  identityNumber: client?.identityNumber || '',
  address: [client?.quartier, client?.ville].filter(Boolean).join(', '),
  profession: client?.profession || '',
  nationality: client?.nationality || '',
  phone: client?.phone || '',
  landowner: clientFullName(client)
});
const documentTemplateContent = title => {
  const template = state.documentTypeTemplates?.[title];
  return DOMPurify.sanitize(typeof template === 'string' ? template : template?.content || '');
};
const documentTemplateDate = value => {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('fr-FR');
};
const renderDocumentTemplate = (template, client, title, city, date) => {
  const variables = {
    'client.nom_complet': clientFullName(client),
    'client.prenom': client?.prenom || '',
    'client.nom': client?.nom || '',
    'client.numero_piece': client?.identityNumber || '',
    'client.adresse': [client?.quartier, client?.ville].filter(Boolean).join(', '),
    'client.ville': client?.ville || '',
    'client.quartier': client?.quartier || '',
    'client.profession': client?.profession || '',
    'client.nationalite': client?.nationality || '',
    'client.telephone': client?.phone || '',
    'document.type': title || '',
    'document.ville': city || '',
    'document.date': documentTemplateDate(date)
  };
  const populatedTemplate = String(template || '').replace(/\{\{([a-z_.]+)\}\}/gi, (placeholder, key) =>
    Object.prototype.hasOwnProperty.call(variables, key.toLocaleLowerCase())
      ? escapeHtml(variables[key.toLocaleLowerCase()])
      : placeholder);
  return DOMPurify.sanitize(populatedTemplate);
};
const clientForDocument = doc => state.clients.find(client => client.id === doc.clientId)
  || (!doc.clientId ? state.clients.find(client => clientFullName(client) === doc.client) : null);
const documentsForClient = (documents, client) => documents.filter(doc => doc.clientId
  ? doc.clientId === client.id
  : doc.client === clientFullName(client));
const urgencyKey = doc => `${doc.clientId || doc.client || ''}|${doc.title || ''}|${doc.expiryDate || ''}`;
const urgencyDismissals = () => new Set(state.urgencyDismissals);
const urgencyItems = () => {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const displayDays = Number(state.settings.urgencyWindowDays) || 30;
  const dismissed = urgencyDismissals();
  return state.docs.flatMap((doc, index) => {
    if (!doc.expiryDate || dismissed.has(urgencyKey(doc))) return [];
    const [year, month, day] = doc.expiryDate.split('-').map(Number);
    if (!year || !month || !day) return [];
    const remainingDays = Math.ceil((Date.UTC(year, month - 1, day) - todayUtc) / 86400000);
    return remainingDays <= displayDays ? [{ doc, index, remainingDays, key: urgencyKey(doc) }] : [];
  }).sort((a, b) => a.remainingDays - b.remainingDays);
};
const starterClientIds = new Set([
  'BETAF-KOUASSI-20260908-1030',
  'BETAF-TRAORE-20260907-1510',
  'BETAF-YAO-20260905-0845'
]);
const starterDocuments = [
  ['Plan topographique', 'Jean Kouassi', 'Terminé', '08 sept. 2026'],
  ['Rapport de suivi de chantier', 'Aminata Traoré', 'En attente', '07 sept. 2026'],
  ['Attestation de propriété', 'Marc Yao', 'Terminé', '05 sept. 2026'],
  ['Devis estimatif', 'Jean Kouassi', 'Brouillon', '04 sept. 2026']
];
const cleanStarterRecords = data => {
  const clients = (data.clients || []).filter(client => !starterClientIds.has(client.id));
  const docs = (data.docs || []).filter(doc => !(
    !doc.clientId
    && Object.keys(doc).length === 4
    && starterDocuments.some(([title, client, status, date]) =>
      doc.title === title && doc.client === client && doc.status === status && doc.date === date)
  ));
  return { ...data, clients, docs, removed: clients.length !== (data.clients || []).length || docs.length !== (data.docs || []).length };
};
const storedClients = JSON.parse(localStorage.getItem('betaf-clients') || 'null');
const storedDocs = JSON.parse(localStorage.getItem('betaf-docs') || 'null');
const initialData = cleanStarterRecords({ clients: storedClients || [], docs: storedDocs || [] });
if (initialData.removed) {
  localStorage.setItem('betaf-clients', JSON.stringify(initialData.clients));
  localStorage.setItem('betaf-docs', JSON.stringify(initialData.docs));
}
const storedSyncConfig = JSON.parse(localStorage.getItem('betaf-sync') || 'null');
const isElectron = window.location.protocol === 'file:';
const storedLegacyUsers = JSON.parse(localStorage.getItem('betaf-users') || '[]');
const legacyUsers = Array.isArray(storedLegacyUsers) ? storedLegacyUsers : [];
const apiBaseUrl = isElectron
  ? (storedSyncConfig?.url || 'http://localhost:3000')
  : (import.meta.env.VITE_API_BASE_URL || '');
const browserBackup = () => JSON.parse(localStorage.getItem('betaf-browser-data-backup') || 'null');
const hasRecords = data => !!(data?.clients?.length || data?.docs?.length || data?.archive?.length || Object.keys(data?.documentTypeTemplates || {}).length);
const state = {
  view: 'dashboard',
  settingsSection: 'profile',
  historyFilter: 'all',
  clientSortDirection: 'asc',
  clients: initialData.clients,
  docs: initialData.docs,
  documentTypes: savedDocumentTypes ? [...new Set([...savedDocumentTypes, villageAttestationType, cessionAttestationType, saleAttestationType])] : documentTypes,
  documentTypeTemplates: savedDocumentTypeTemplates && typeof savedDocumentTypeTemplates === 'object' && !Array.isArray(savedDocumentTypeTemplates) ? savedDocumentTypeTemplates : {},
  archive: JSON.parse(localStorage.getItem('betaf-archive') || 'null') || [],
  settings: {
    font: 'Arial', city: 'Abidjan', watermark: true, intensity: 12,
    logo: '', footer: 'BETAF-N°R.C.C.M : CI-ABG-2024-B-117 - SIEGE SOCIAL : AGNIBILEKROU QUARTIER MAIRIE-NORD à 600 mètres DU MOULIN SANGARE | TEL : NUMERO DE LA STRUCTURE',
    theme: 'light', urgencyWindowDays: 30,
    ...(JSON.parse(localStorage.getItem('betaf-settings') || 'null') || {})
  },
  urgencyDismissals: JSON.parse(localStorage.getItem('betaf-urgency-dismissals') || '[]'),
  users: [],
  auditEntries: [],
  settingsLoaded: false,
  currentUser: localStorage.getItem('betaf-api-token') ? JSON.parse(localStorage.getItem('betaf-current-user') || 'null') : null
};

const syncConfig = {
  url: apiBaseUrl,
  token: localStorage.getItem('betaf-api-token') || (isElectron ? storedSyncConfig?.token || '' : ''),
  version: 0,
  online: false
};
let syncTimer;
let syncBusy = false;
const localData = () => ({ clients: state.clients, docs: state.docs, documentTypes: state.documentTypes, documentTypeTemplates: state.documentTypeTemplates, archive: state.archive, settings: state.settings, urgencyDismissals: state.urgencyDismissals });
const save = () => {
  localStorage.setItem('betaf-clients', JSON.stringify(state.clients));
  localStorage.setItem('betaf-docs', JSON.stringify(state.docs));
  localStorage.setItem('betaf-document-types', JSON.stringify(state.documentTypes));
  localStorage.setItem('betaf-document-type-templates', JSON.stringify(state.documentTypeTemplates));
  localStorage.setItem('betaf-archive', JSON.stringify(state.archive));
  localStorage.setItem('betaf-settings', JSON.stringify(state.settings));
  localStorage.setItem('betaf-urgency-dismissals', JSON.stringify(state.urgencyDismissals));
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncPush(), 250);
};
async function syncRequest(path, options = {}) {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(syncConfig.token ? { Authorization: `Bearer ${syncConfig.token}` } : {}), ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result.error === 'string' ? result.error : result.error?.message;
    const error = new Error(message || `Le serveur a répondu avec le code ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return result;
}
async function syncPush() {
  if (syncBusy || !syncConfig.token) return;
  syncBusy = true;
  try {
    const result = await syncRequest('/api/state', { method: 'PUT', body: JSON.stringify({ version: syncConfig.version, data: localData() }) });
    syncConfig.version = result.version;
    syncConfig.online = true;
  } catch (error) {
    syncConfig.online = false;
    toast(`Synchronisation impossible : ${error.message}`);
  } finally { syncBusy = false; }
}
async function syncPull() {
  if (!syncConfig.token || syncBusy) return;
  syncBusy = true;
  let republishCleanedData = false;
  try {
    const result = await syncRequest('/api/state');
    if (result.data) {
      const cleanData = cleanStarterRecords(result.data);
      state.clients = cleanData.clients;
      state.docs = cleanData.docs;
      republishCleanedData = cleanData.removed;
      state.documentTypes = [...new Set([...(result.data.documentTypes || []), villageAttestationType, cessionAttestationType, saleAttestationType])];
      state.documentTypeTemplates = result.data.documentTypeTemplates && typeof result.data.documentTypeTemplates === 'object' && !Array.isArray(result.data.documentTypeTemplates) ? result.data.documentTypeTemplates : {};
      state.archive = result.data.archive || [];
      state.settings = { ...state.settings, ...(result.data.settings || {}) };
      state.urgencyDismissals = result.data.urgencyDismissals || [];
      syncConfig.version = result.version;
      syncConfig.online = true;
      saveLocalOnly();
      render();
    }
  } catch (error) {
    syncConfig.online = false;
    if (error.status === 401) {
      clearSession();
      render();
    } else {
      toast(`Chargement des données impossible : ${error.message}`);
    }
  } finally {
    syncBusy = false;
    if (republishCleanedData) syncPush();
  }
}
const saveLocalOnly = () => {
  localStorage.setItem('betaf-clients', JSON.stringify(state.clients));
  localStorage.setItem('betaf-docs', JSON.stringify(state.docs));
  localStorage.setItem('betaf-document-types', JSON.stringify(state.documentTypes));
  localStorage.setItem('betaf-document-type-templates', JSON.stringify(state.documentTypeTemplates));
  localStorage.setItem('betaf-archive', JSON.stringify(state.archive));
  localStorage.setItem('betaf-settings', JSON.stringify(state.settings));
  localStorage.setItem('betaf-urgency-dismissals', JSON.stringify(state.urgencyDismissals));
};
async function connectServer() {
  showModal('connect-server');
}
setInterval(() => syncPull(), 15000);
const saveSession = () => {
  if (syncConfig.token) localStorage.setItem('betaf-api-token', syncConfig.token);
  if (state.currentUser) localStorage.setItem('betaf-current-user', JSON.stringify(state.currentUser));
};
async function loadAdminSettings() {
  const [users, audit] = await Promise.all([
    syncRequest('/api/users'),
    syncRequest('/api/audit')
  ]);
  state.users = users.users;
  state.auditEntries = audit.entries;
}
async function recordAction(action, details = '') {
  try {
    await syncRequest('/api/audit', {
      method: 'POST',
      body: JSON.stringify({ action, details })
    });
  } catch (error) {
    toast(`Action non enregistrée dans le journal : ${error.message}`);
  }
}
const clearSession = () => {
  syncConfig.token = '';
  syncConfig.online = false;
  state.currentUser = null;
  localStorage.removeItem('betaf-api-token');
  localStorage.removeItem('betaf-current-user');
};
const roleLabel = role => role === 'admin' ? 'Administrateur' : 'Gestionnaire';
const icon = (name) => {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    types: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v4M12 17h.01"/>',
    sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
    edit: '<path d="m4 16-.8 4.8L8 20l11-11-4-4L4 16zM13.5 6.5l4 4"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5z"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
};
const formatDashboardDate = () => new Date().toLocaleString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/^./, char => char.toUpperCase());
const initials = (name) => name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
let dashboardClock;

function layout(content) {
  const nav = [
    ['dashboard', 'Tableau de bord', 'grid'],
    ['clients', 'Gérer les clients', 'users'],
    ['documents', 'Gérer les documents', 'doc'],
    ['history', 'Historique', 'clock'],
    ['urgency', 'Urgence', 'alert'],
    ['settings', 'Paramètres', 'sliders']
  ];
  return `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"><img src="${state.settings.logo || betafLogoUrl}" alt="Logo BETAF"></div><div><strong>BETAF</strong><small>STUDIO</small></div></div>
      <nav class="desktop-navigation" aria-label="Navigation principale">${nav.map(([id, label, ico]) => `<button class="${state.view === id ? 'active' : ''}" data-nav="${id}"><span class="nav-icon">${icon(ico)}</span>${label}${id === 'urgency' && urgencyItems().length ? `<b class="badge">${urgencyItems().length}</b>` : ''}</button>`).join('')}</nav>
      <div class="mobile-navigation"><button class="mobile-menu-trigger" type="button" data-action="open-mobile-drawer" aria-controls="mobile-navigation-drawer" aria-expanded="false" aria-label="Ouvrir le menu de navigation"><span>Menu</span>${icon('menu')}</button></div>
      <div class="sidebar-bottom"><div class="help"><span>?</span><div><b>Besoin d’aide ?</b><small>Consulter le guide BETAF</small></div></div></div>
    </aside>
    <dialog class="mobile-drawer" id="mobile-navigation-drawer" aria-label="Navigation principale">
      <div class="mobile-drawer-panel">
        <div class="mobile-drawer-header">
          <div class="brand"><div class="brand-mark"><img src="${state.settings.logo || betafLogoUrl}" alt="Logo BETAF"></div><div><strong>BETAF</strong><small>STUDIO</small></div></div>
          <button class="mobile-drawer-close" type="button" data-action="close-mobile-drawer" aria-label="Fermer le menu">${icon('close')}</button>
        </div>
        <p class="mobile-drawer-label">Navigation principale</p>
        <nav class="mobile-drawer-links" aria-label="Rubriques principales">${nav.map(([id, label, ico]) => `<button type="button" class="${state.view === id ? 'active' : ''}" aria-current="${state.view === id ? 'page' : 'false'}" data-nav="${id}">${icon(ico)}<span>${escapeHtml(label)}</span>${id === 'urgency' && urgencyItems().length ? `<b class="badge">${urgencyItems().length}</b>` : ''}</button>`).join('')}</nav>
        <div class="mobile-drawer-account"><div class="avatar blue-bg">${initials(state.currentUser?.fullname || state.currentUser?.username || 'Compte')}</div><div><b>${escapeHtml(state.currentUser?.fullname || state.currentUser?.username || 'Compte')}</b><small>${roleLabel(state.currentUser?.role)}</small></div></div>
      </div>
    </dialog>
    <main class="main"><header><div class="crumb">BETAF Studio <span>/</span> ${nav.find(x => x[0] === state.view)?.[1] || ''}</div><div class="header-actions"><span class="top-profile">${state.currentUser?.fullname || ''}</span><button class="icon-button" data-action="global-search" title="Rechercher">${icon('search')}</button><button class="icon-button" data-action="notifications" title="Notifications">${icon('alert')}</button><button class="icon-button" data-action="toggle-theme" title="Changer le thème">${icon(state.settings.theme === 'dark' ? 'sun' : 'moon')}</button><button class="secondary" data-action="logout">Déconnexion</button></div></header>${content}</main>
  </div>`;
}

function dashboard() {
  return `<section class="page"><div class="page-heading"><div><p class="eyebrow" id="dashboard-date">${formatDashboardDate()}</p><h1>Bienvenue dans BETAF Studio</h1><p class="muted">Voici un aperçu de l’activité de votre bureau aujourd’hui.</p></div><button class="primary" data-action="new-doc">${icon('plus')} Nouveau document</button></div>
    <div class="stat-grid"><div class="stat-card"><div class="stat-icon blue">${icon('users')}</div><span>Clients enregistrés</span><strong>${state.clients.length}</strong><small class="up">12,5% <em>vs. mois dernier</em></small></div><div class="stat-card"><div class="stat-icon purple">${icon('doc')}</div><span>Documents ce mois</span><strong>${state.docs.length}</strong><small class="up">8,2% <em>vs. mois dernier</em></small></div><div class="stat-card"><div class="stat-icon orange">${icon('clock')}</div><span>En attente</span><strong>${state.docs.filter(d => d.status === 'En attente').length}</strong><small class="neutral">À traiter prochainement</small></div><div class="stat-card"><div class="stat-icon red">${icon('alert')}</div><span>Documents urgents</span><strong>${urgencyItems().length}</strong><small class="neutral">À échéance dans ${Number(state.settings.urgencyWindowDays) || 30} jours</small></div></div>
    <div class="section-grid"><div class="panel"><div class="panel-heading"><div><h2>Clients récemment ajoutés</h2><p>Les 3 derniers clients de votre espace</p></div><button class="text-button" data-nav="clients">Voir tout ${icon('arrow')}</button></div><div class="client-list">${state.clients.slice(0,3).map(c => `<div class="list-row"><div class="avatar ${['blue-bg','purple-bg','orange-bg'][Math.abs(c.nom.charCodeAt(0)) % 3]}">${initials(c.prenom + ' ' + c.nom)}</div><div class="row-main"><b>${c.prenom} ${c.nom}</b><small>${c.id}</small></div><span class="row-date">${c.created}</span><button class="more">${icon('more')}</button></div>`).join('')}</div></div>
    <div class="panel"><div class="panel-heading"><div><h2>Documents traités</h2><p>Suivi de vos dernières activités</p></div><button class="text-button" data-nav="history">Voir tout ${icon('arrow')}</button></div><div class="doc-list">${state.docs.slice(0,4).map(d => `<div class="list-row"><div class="doc-icon">${icon('doc')}</div><div class="row-main"><b>${d.title}</b><small>${d.client}</small></div><span class="status ${d.status.toLowerCase().replace('é','e')}">${d.status}</span></div>`).join('')}</div></div></div>
    <div class="quick-banner"><div class="banner-symbol">✦</div><div><b>Créez vos documents en quelques clics</b><p>Utilisez vos modèles enregistrés pour gagner du temps au quotidien.</p></div><button class="secondary" data-action="new-doc">Créer un document ${icon('arrow')}</button></div></section>`;
}

function clients() {
  return `<section class="page"><div class="page-heading"><div><p class="eyebrow">ESPACE CLIENTS</p><h1>Gérer les clients</h1><p class="muted">Retrouvez et gérez toutes les informations de vos clients.</p></div><button class="primary" data-action="new-client">${icon('plus')} Ajouter un client</button></div><div class="toolbar"><div class="search"><span>${icon('search')}</span><input id="client-search" placeholder="Rechercher un client..." /></div><button class="filter" data-action="sort-clients">Nom <span id="sort-indicator">${state.clientSortDirection === 'asc' ? 'A → Z' : 'Z → A'}</span></button></div><div class="panel table-panel"><table><thead><tr><th>CLIENT</th><th>CODE PERSONNEL</th><th>LOCALISATION</th><th>PIÈCE</th><th>AJOUTÉ LE</th><th>ACTIONS</th></tr></thead><tbody>${state.clients.map(c => `<tr><td><div class="table-client"><div class="avatar blue-bg">${initials(c.prenom + ' ' + c.nom)}</div><div><b>${c.prenom} ${c.nom}</b><small>${c.phone || 'Téléphone non renseigné'}</small></div></div></td><td><code>${c.id}</code></td><td>${c.ville}<small>${c.quartier || 'Quartier non renseigné'}</small></td><td><span class="piece">${c.piece || 'Aucune'}</span>${c.pieceFileName ? `<small class="file-status">Pièce jointe : ${c.pieceFileName}</small>` : ''}</td><td>${c.created}</td><td><div class="client-actions"><button class="action-icon view-action" title="Voir la fiche et les documents" aria-label="Voir" data-action="view-client" data-client-id="${c.id}">${icon('eye')}</button><button class="action-icon edit-action" title="Modifier le client" aria-label="Modifier" data-action="edit-client" data-client-id="${c.id}">${icon('edit')}</button><button class="action-icon delete-action" title="Supprimer le client" aria-label="Supprimer" data-client-menu="${c.id}">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div></section>`;
}

function history() {
  const visibleDocs = state.docs.map((doc, index) => ({ doc, index })).filter(({ doc }) => state.historyFilter !== 'pending' || doc.status === 'En attente');
  const rows = visibleDocs.map(({ doc: d, index: i }) => `<tr><td><div class="table-client"><div class="doc-icon">${icon('doc')}</div><div><b>${d.title}</b><small>Document BETAF</small></div></div></td><td>${d.client}</td><td><span class="status ${d.status.toLowerCase().replace('é','e')}">${d.status}</span></td><td>${d.date}</td><td><div class="client-actions"><button class="action-icon view-action" title="Voir" data-action="view-doc" data-doc-index="${i}">${icon('eye')}</button><button class="action-icon print-action" title="Imprimer" data-action="print-doc" data-doc-index="${i}">${icon('print')}</button><button class="action-icon edit-action" title="Modifier" data-action="edit-doc" data-doc-index="${i}">${icon('edit')}</button><button class="action-icon delete-action" title="Supprimer" data-doc-menu="${i}">${icon('trash')}</button></div></td></tr>`).join('');
  const archiveRows = state.archive.map((d, i) => `<tr><td>${d.title}</td><td>${d.client}</td><td>${d.deletedAt}</td><td><button class="secondary table-action" data-action="restore-doc" data-archive-index="${i}">Restaurer</button></td></tr>`).join('');
  const showingArchive = state.historyFilter === 'trash';
  return `<section class="page"><div class="page-heading"><div><p class="eyebrow">SUIVI D’ACTIVITÉ</p><h1>Historique</h1><p class="muted">Documents traités, brouillons et documents archivés.</p></div><div class="heading-actions"><button class="secondary" data-action="export-data">${icon('download')} Exporter les données</button><button class="primary" data-action="new-doc">${icon('plus')} Nouveau document</button></div></div><div class="history-tabs"><button class="${state.historyFilter === 'all' ? 'active' : ''}" data-history-tab="all">Tous <b>${state.docs.length}</b></button><button class="${state.historyFilter === 'pending' ? 'active' : ''}" data-history-tab="pending">En attente <b>${state.docs.filter(d => d.status === 'En attente').length}</b></button><button class="${showingArchive ? 'active' : ''}" data-history-tab="trash">Corbeille <b>${state.archive.length}</b></button></div>${showingArchive ? `<div class="panel archive-panel"><h2>Archive — documents supprimés</h2><table><thead><tr><th>DOCUMENT</th><th>CLIENT</th><th>SUPPRIMÉ LE</th><th></th></tr></thead><tbody>${archiveRows || '<tr><td colspan="4">La corbeille est vide.</td></tr>'}</tbody></table></div>` : `<div class="panel table-panel"><table><thead><tr><th>DOCUMENT</th><th>CLIENT</th><th>STATUT</th><th>DATE</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">Aucun document dans cette vue.</td></tr>'}</tbody></table></div>`}</section>`;
}

function documents() {
  const manageTypesButton = state.currentUser?.role === 'admin'
    ? `<button class="secondary" data-action="manage-document-types">${icon('types')} Gérer les types</button>`
    : '';
  const rows = state.docs.map((d, i) => `<tr><td><div class="table-client"><div class="doc-icon">${icon('doc')}</div><div><b>${d.title}</b><small>${d.client}</small></div></div></td><td><span class="status ${d.status.toLowerCase().replace('é','e')}">${d.status}</span></td><td>${d.date}</td><td>${d.expiryDate || 'Aucune'}</td><td><div class="client-actions"><button class="action-icon view-action" title="Voir" data-action="view-doc" data-doc-index="${i}">${icon('eye')}</button><button class="action-icon print-action" title="Imprimer" data-action="print-doc" data-doc-index="${i}">${icon('print')}</button><button class="action-icon edit-action" title="Modifier" data-action="edit-doc" data-doc-index="${i}">${icon('edit')}</button><button class="action-icon delete-action" title="Supprimer" data-doc-menu="${i}">${icon('trash')}</button></div></td></tr>`).join('');
  return `<section class="page"><div class="page-heading"><div><p class="eyebrow">ESPACE DOCUMENTS</p><h1>Gérer les documents</h1><p class="muted">Créez, modifiez, imprimez et archivez tous vos documents BETAF.</p></div><div class="heading-actions">${manageTypesButton}<button class="primary" data-action="new-doc">${icon('plus')} Nouveau document</button></div></div><div class="toolbar"><div class="search"><span>${icon('search')}</span><input id="document-search" placeholder="Rechercher un document ou un client..." /></div><button class="filter" data-action="filter-documents">Tous les statuts</button></div><div class="panel table-panel"><table><thead><tr><th>DOCUMENT</th><th>STATUT</th><th>CRÉÉ LE</th><th>EXPIRATION</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">Aucun document enregistré.</td></tr>'}</tbody></table></div></section>`;
}

function urgency() {
  const isAdmin = state.currentUser?.role === 'admin';
  const items = urgencyItems();
  const cards = items.map(({ doc, remainingDays, key }) => {
    const client = clientForDocument(doc) || doc.clientSnapshot;
    const name = clientFullName(client) || doc.client || 'Client non renseigné';
    const expiry = new Date(`${doc.expiryDate}T12:00:00`).toLocaleDateString('fr-FR');
    const timing = remainingDays < 0 ? `En retard de ${Math.abs(remainingDays)} jour(s)` : remainingDays === 0 ? 'Échéance aujourd’hui' : `Dans ${remainingDays} jour(s)`;
    return `<article class="panel urgency-card"><div class="urgency-top"><div class="avatar red-bg">${escapeHtml(initials(name))}</div><span class="urgent-label">${timing}</span></div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(doc.title)}</p><div class="urgency-footer"><small>Expiration : ${expiry}</small><div class="urgency-actions">${client?.phone ? `<button class="secondary small-button" data-action="remind" data-client="${escapeHtml(name)}" data-phone="${escapeHtml(client.phone)}" data-title="${escapeHtml(doc.title)}">Rappeler</button>` : ''}${isAdmin ? `<button class="secondary small-button" data-action="dismiss-urgency" data-urgency-key="${escapeHtml(encodeURIComponent(key))}">Masquer</button>` : ''}</div></div></article>`;
  }).join('');
  const dismissed = isAdmin ? state.urgencyDismissals.map(key => {
    const doc = state.docs.find(item => urgencyKey(item) === key);
    if (!doc) return '';
    const client = clientForDocument(doc) || doc.clientSnapshot;
    return `<div class="linked-document"><div><b>${escapeHtml(doc.title)}</b><small>${escapeHtml(clientFullName(client) || doc.client)} · Expiration : ${new Date(`${doc.expiryDate}T12:00:00`).toLocaleDateString('fr-FR')}</small></div><button class="secondary small-button" data-action="restore-urgency" data-urgency-key="${escapeHtml(encodeURIComponent(key))}">Rétablir</button></div>`;
  }).filter(Boolean).join('') : '';
  return `<section class="page"><div class="page-heading"><div><p class="eyebrow">À NE PAS OUBLIER</p><h1>Urgence</h1><p class="muted">Alertes calculées à partir des échéances enregistrées sur les documents.</p></div>${isAdmin ? `<label class="urgency-window-control">Afficher les échéances dans les prochains<select id="urgency-window"><option value="7" ${Number(state.settings.urgencyWindowDays) === 7 ? 'selected' : ''}>7 jours</option><option value="15" ${Number(state.settings.urgencyWindowDays) === 15 ? 'selected' : ''}>15 jours</option><option value="30" ${Number(state.settings.urgencyWindowDays) === 30 ? 'selected' : ''}>30 jours</option><option value="60" ${Number(state.settings.urgencyWindowDays) === 60 ? 'selected' : ''}>60 jours</option><option value="90" ${Number(state.settings.urgencyWindowDays) === 90 ? 'selected' : ''}>90 jours</option></select></label>` : ''}</div><div class="notice"><span>${icon('alert')}</span><div><b>${items.length ? `${items.length} document(s) nécessitent votre attention` : 'Aucune échéance à signaler'}</b><p>Les documents arrivant à échéance ou déjà échus apparaissent ici. ${isAdmin ? 'Vous pouvez masquer une alerte ou la rétablir.' : ''}</p></div></div>${items.length ? `<div class="urgency-grid">${cards}</div>` : '<div class="panel empty-urgencies"><p class="muted">Aucun document n’expire dans la période sélectionnée. Vérifiez que les dates d’échéance sont renseignées lors de la création des documents.</p></div>'}${dismissed ? `<div class="panel dismissed-urgencies"><h2>Alertes masquées (${state.urgencyDismissals.length})</h2><div class="linked-documents">${dismissed}</div></div>` : ''}</section>`;
}

function settings() {
  const isAdmin = state.currentUser?.role === 'admin';
  const sections = [
    { id: 'profile', label: 'Mon profil', icon: 'edit', description: 'Vos coordonnées personnelles et votre mot de passe.' },
    ...(isAdmin ? [
      { id: 'identity', label: 'Organisation', icon: 'sliders', description: 'Identité et préférences générales de votre structure.' },
      { id: 'documents', label: 'Modèles de documents', icon: 'doc', description: 'Types proposés lors de la création d’un document.' },
      { id: 'watermark', label: 'Filigrane & logo', icon: 'eye', description: 'Personnalisez le logo et le filigrane des documents.' },
      { id: 'footer', label: 'Pied de page', icon: 'types', description: 'Mentions et coordonnées imprimées sur les documents.' },
      { id: 'users', label: 'Comptes & accès', icon: 'users', description: 'Gérez les comptes et les autorisations des membres.' },
      { id: 'audit', label: 'Journal d’activité', icon: 'clock', description: 'Consultez les actions effectuées sur la plateforme.' }
    ] : [])
  ];
  if (!sections.some(section => section.id === state.settingsSection)) {
    state.settingsSection = 'profile';
  }
  const activeSection = sections.find(section => section.id === state.settingsSection);
  const auditActionLabel = action => ({
    login: 'Connexion',
    logout: 'Déconnexion',
    'profile-updated': 'Profil modifié',
    'password-changed': 'Mot de passe modifié',
    'password-reset': 'Mot de passe réinitialisé',
    'user-created': 'Compte créé',
    'user-imported': 'Compte importé',
    'user-account-updated': 'Compte modifié',
    'user-archived': 'Compte archivé',
    'browser-data-imported': 'Données locales importées',
    'client-created': 'Client créé',
    'client-updated': 'Client modifié',
    'client-deleted': 'Client archivé',
    'document-created': 'Document créé',
    'document-updated': 'Document modifié',
    'document-deleted': 'Document archivé',
    'document-types-updated': 'Types de documents modifiés',
    'settings-updated': 'Paramètres modifiés',
    'archive-updated': 'Archive modifiée',
    'urgency-updated': 'Alertes modifiées',
    'document-printed': 'Document imprimé',
    'data-exported': 'Données exportées',
    'state-updated': 'Données mises à jour'
  }[action] || action);
  const userRows = state.users.map(user => {
    const status = user.is_archived ? 'Archivé' : user.is_active ? 'Actif' : 'Suspendu';
    const ownAccount = user.id === state.currentUser?.id;
    return `<article class="account-row"><div class="account-summary"><div class="avatar blue-bg">${escapeHtml(initials(user.fullname || user.username))}</div><div class="row-main"><b>${escapeHtml(user.fullname)}</b><small>${escapeHtml(user.username)} · ${roleLabel(user.role)}</small><small>${escapeHtml(user.email || 'E-mail non renseigné')} · ${escapeHtml(user.phone || 'Téléphone non renseigné')}</small></div><span class="account-status ${user.is_archived ? 'archived' : user.is_active ? 'active' : 'suspended'}">${status}</span></div><div class="account-actions"><select aria-label="Rôle de ${escapeHtml(user.username)}" data-action="change-user-role" data-user-id="${escapeHtml(user.id)}" ${ownAccount || user.is_archived ? 'disabled' : ''}><option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Gestionnaire</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrateur</option></select><button class="secondary" data-action="reset-user-password" data-user-id="${escapeHtml(user.id)}" ${user.is_archived ? 'disabled' : ''}>Réinitialiser le mot de passe</button>${user.is_archived ? `<button class="secondary" data-action="restore-user" data-user-id="${escapeHtml(user.id)}">Restaurer</button>` : `<button class="secondary" data-action="toggle-user-active" data-user-id="${escapeHtml(user.id)}" data-active="${user.is_active}" ${ownAccount ? 'disabled' : ''}>${user.is_active ? 'Suspendre' : 'Réactiver'}</button><button class="danger-action" data-action="archive-user" data-user-id="${escapeHtml(user.id)}" ${ownAccount ? 'disabled' : ''}>Archiver</button>`}</div></article>`;
  }).join('');
  const auditRows = state.auditEntries.map(entry => `<tr><td>${escapeHtml(new Date(entry.created_at).toLocaleString('fr-FR'))}</td><td><b>${escapeHtml(entry.fullname || entry.username)}</b><small>${escapeHtml(entry.username)}</small></td><td>${escapeHtml(auditActionLabel(entry.action))}</td><td>${escapeHtml(entry.details || '—')}</td></tr>`).join('');
  const profilePanel = `
    <section class="settings-card">
      <div class="settings-card-heading">
        <div class="settings-card-icon">${icon('edit')}</div>
        <div><h2>Informations personnelles</h2><p>Coordonnées associées à votre compte BETAF.</p></div>
      </div>
      <form id="profile-form">
        <div class="form-row">
          <label>Nom complet<input name="fullname" value="${escapeHtml(state.currentUser?.fullname || '')}" required /></label>
          <label>Nom d’utilisateur<input value="${escapeHtml(state.currentUser?.username || '')}" disabled /></label>
        </div>
        <div class="form-row">
          <label>Adresse e-mail<input name="email" type="email" value="${escapeHtml(state.currentUser?.email || '')}" /></label>
          <label>Numéro de téléphone<input name="phone" type="tel" value="${escapeHtml(state.currentUser?.phone || '')}" /></label>
        </div>
        <div class="settings-actions"><button class="primary" type="submit">Enregistrer mon profil</button></div>
      </form>
    </section>
    <section class="settings-card">
      <div class="settings-card-heading">
        <div class="settings-card-icon">${icon('eye')}</div>
        <div><h2>Sécurité du compte</h2><p>Modifiez votre mot de passe pour protéger l’accès à votre compte.</p></div>
      </div>
      <form id="profile-password-form">
        <label>Mot de passe actuel<input name="current_password" type="password" required autocomplete="current-password" /></label>
        <div class="form-row">
          <label>Nouveau mot de passe<input name="new_password" type="password" minlength="12" required autocomplete="new-password" /></label>
          <label>Confirmer le nouveau mot de passe<input name="confirm_password" type="password" minlength="12" required autocomplete="new-password" /></label>
        </div>
        <div class="settings-actions"><button class="secondary" type="submit">Mettre à jour le mot de passe</button></div>
      </form>
    </section>`;
  const identityPanel = `<section class="settings-card"><div class="settings-card-heading"><div class="settings-card-icon">${icon('sliders')}</div><div><h2>Identité de la structure</h2><p>Informations utilisées dans les documents BETAF.</p></div></div><label>Nom de la structure<input value="BETAF — Bureau d’étude topographique et d’aménagement foncier" disabled /></label><div class="form-row"><label>Ville de création<input id="setting-city" value="${escapeHtml(state.settings.city)}" /></label><label>Police par défaut<select id="setting-font"><option ${state.settings.font === 'Arial' ? 'selected' : ''}>Arial</option><option ${state.settings.font === 'Inter' ? 'selected' : ''}>Inter</option><option ${state.settings.font === 'Georgia' ? 'selected' : ''}>Georgia</option><option ${state.settings.font === 'Times New Roman' ? 'selected' : ''}>Times New Roman</option></select></label></div></section>`;
  const documentTypeRows = state.documentTypes.map((name, index) => `<div class="type-row"><span>${escapeHtml(name)}</span><div><button class="action-icon edit-action" title="Modifier" aria-label="Modifier ${escapeHtml(name)}" data-action="edit-document-type" data-type-index="${index}">${icon('edit')}</button><button class="action-icon delete-action" title="Supprimer" aria-label="Supprimer ${escapeHtml(name)}" data-action="delete-document-type" data-type-index="${index}">${icon('trash')}</button></div></div>`).join('');
  const documentTypesPanel = `<section class="settings-card"><div class="settings-card-heading"><div class="settings-card-icon">${icon('doc')}</div><div><h2>Types de documents</h2><p>Ces modèles apparaissent lors de la création d’un document.</p></div></div><div class="section-heading"><span class="type-count">${state.documentTypes.length} type(s)</span><button class="primary" data-action="new-document-type">${icon('plus')} Ajouter un type</button></div><div class="type-list">${documentTypeRows || '<p class="muted empty-types">Aucun type de document enregistré.</p>'}</div></section>`;
  const watermarkPanel = `<section class="settings-card"><div class="settings-card-heading"><div class="settings-card-icon">${icon('eye')}</div><div><h2>Filigrane et logo</h2><p>Personnalisez l’apparence des documents imprimés.</p></div></div><div class="toggle-row"><div><b>Filigrane BETAF</b><small>Filigrane répété sur les pages des documents</small></div><button class="toggle ${state.settings.watermark ? 'on' : ''}" data-action="toggle-watermark"><span></span></button></div><label>Intensité du filigrane<input id="setting-intensity" type="range" min="4" max="35" value="${state.settings.intensity}" /></label><div class="logo-upload"><div class="logo-preview">${state.settings.logo ? `<img src="${state.settings.logo}" alt="Logo BETAF" />` : `<img src="${betafLogoUrl}" alt="Logo BETAF" />`}</div><div><b>Logo de la structure</b><p>PNG, JPG ou SVG recommandé</p><input id="logo-file" type="file" accept="image/png,image/jpeg,image/svg+xml" /></div></div></section>`;
  const footerPanel = `<section class="settings-card"><div class="settings-card-heading"><div class="settings-card-icon">${icon('types')}</div><div><h2>Pied de page</h2><p>Mentions et coordonnées imprimées sur les documents.</p></div></div><label>Contenu du pied de page<textarea id="setting-footer">${escapeHtml(state.settings.footer)}</textarea></label></section>`;
  const usersPanel = `<section class="settings-card"><div class="settings-card-heading"><div class="settings-card-icon">${icon('users')}</div><div><h2>Comptes et accès</h2><p>Seuls les administrateurs peuvent créer, suspendre, archiver et réinitialiser les comptes.</p></div></div><div class="account-list">${userRows || '<p class="muted">Aucun compte utilisateur.</p>'}</div><form id="user-form" class="account-create-form"><h3>Créer un compte</h3><div class="form-row"><label>Nom complet<input name="fullname" required maxlength="200" /></label><label>Nom d’utilisateur<input name="username" required maxlength="100" autocomplete="off" /></label></div><div class="form-row"><label>Adresse e-mail<input name="email" type="email" /></label><label>Numéro de téléphone<input name="phone" type="tel" /></label></div><div class="form-row"><label>Mot de passe provisoire<input name="password" type="password" minlength="12" required autocomplete="new-password" /></label><label>Rôle<select name="role"><option value="manager">Gestionnaire</option><option value="admin">Administrateur</option></select></label></div><p class="form-hint">Le membre devra choisir un nouveau mot de passe à sa première connexion.</p><p class="form-error" id="user-form-error" role="alert"></p><button class="primary" type="submit">Créer le compte</button></form></section>`;
  const auditPanel = `<section class="settings-card"><div class="settings-card-heading"><div class="settings-card-icon">${icon('clock')}</div><div><h2>Journal d’activité</h2><p>Les actions des administrateurs et gestionnaires sont enregistrées; ce journal est visible uniquement par les administrateurs.</p></div></div><div class="table-panel audit-table"><table><thead><tr><th>DATE</th><th>MEMBRE</th><th>ACTION</th><th>DÉTAILS</th></tr></thead><tbody>${auditRows || '<tr><td colspan="4">Aucune action enregistrée.</td></tr>'}</tbody></table></div></section>`;
  const panels = {
    profile: profilePanel,
    identity: identityPanel,
    documents: documentTypesPanel,
    watermark: watermarkPanel,
    footer: footerPanel,
    users: usersPanel,
    audit: auditPanel
  };
  const saveButton = ['identity', 'watermark', 'footer'].includes(activeSection.id)
    ? '<button class="primary" data-action="save-settings">Enregistrer</button>'
    : '';
  return `<section class="page settings-page"><div class="page-heading"><div><p class="eyebrow">ESPACE DE CONFIGURATION</p><h1>${escapeHtml(activeSection.label)}</h1><p class="muted">${escapeHtml(activeSection.description)}</p></div>${saveButton}</div><div class="settings-layout"><aside class="settings-nav" aria-label="Navigation des paramètres"><div class="settings-nav-title">${icon('sliders')} Sections</div><div class="settings-nav-links">${sections.map(section => `<button type="button" class="${section.id === activeSection.id ? 'active' : ''}" aria-current="${section.id === activeSection.id ? 'page' : 'false'}" data-setting-tab="${section.id}">${icon(section.icon)} ${escapeHtml(section.label)}</button>`).join('')}</div><label class="settings-mobile-select"><span>Rubrique des paramètres</span><select data-setting-select aria-label="Rubrique des paramètres">${sections.map(section => `<option value="${section.id}" ${section.id === activeSection.id ? 'selected' : ''}>${escapeHtml(section.label)}</option>`).join('')}</select></label></aside><div class="settings-form">${panels[activeSection.id]}</div></div></section>`;
}

function modal(type, index, clientId) {
  if (type === 'connect-server') {
    return `<div class="modal-backdrop"><div class="modal server-connect-modal"><button class="modal-close" data-action="close">${icon('close')}</button><p class="eyebrow">API BETAF</p><h2>Connecter à l’API</h2><p class="muted">Saisissez l’adresse HTTPS de l’API hébergée et vos identifiants API BETAF.</p><form id="server-connect-form"><label>Adresse de l’API<input name="url" required value="${syncConfig.url}" placeholder="https://api.votre-domaine.com" /></label><small class="form-hint">Exemple : https://api.votre-domaine.com</small><label>Nom d’utilisateur<input name="username" required value="admin" autocomplete="username" /></label><label>Mot de passe<input name="password" type="password" required autocomplete="current-password" /></label><p class="form-error" id="server-connect-error" role="alert"></p><div class="modal-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button class="primary" type="submit">Tester et connecter</button></div></form></div></div>`;
  }
  if (type === 'reset-user-password') {
    const user = state.users.find(item => item.id === index);
    return `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close">${icon('close')}</button><p class="eyebrow">SÉCURITÉ DU COMPTE</p><h2>Réinitialiser le mot de passe</h2><p class="muted">Un mot de passe provisoire sera transmis à ${escapeHtml(user?.fullname || 'ce membre')}. Il devra en choisir un nouveau à sa prochaine connexion.</p><form id="reset-password-form"><label>Mot de passe provisoire<input name="temporary_password" type="password" minlength="12" required autocomplete="new-password" /></label><p class="form-error" id="reset-password-error" role="alert"></p><div class="modal-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button class="primary" type="submit">Réinitialiser</button></div></form></div></div>`;
  }
  if (type === 'new-client' || type === 'edit-client') {
    const current = type === 'edit-client' ? state.clients.find(c => c.id === index) || {} : {};
    const hasPiece = !!current.piece;
    const pieceTypes = ['CNI', 'Passeport', 'Visa', 'Carte consulaire', 'Carte de séjour', 'Permis de conduire', 'Autre'];
    const pieceOptions = [...new Set([...pieceTypes, ...(current.piece && !pieceTypes.includes(current.piece) ? [current.piece] : [])])]
      .map(piece => `<option value="${escapeHtml(piece)}" ${current.piece === piece ? 'selected' : ''}>${escapeHtml(piece)}</option>`).join('');
    const frontName = current.pieceFrontFileName || current.pieceFileName || '';
    const backName = current.pieceBackFileName || '';
    return `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close">${icon('close')}</button><p class="eyebrow">${type === 'edit-client' ? 'MODIFIER LE DOSSIER' : 'NOUVEAU DOSSIER'}</p><h2>${type === 'edit-client' ? 'Modifier le client' : 'Ajouter un client'}</h2><p class="muted">${type === 'edit-client' ? 'Actualisez les informations enregistrées.' : 'Le code personnel sera créé automatiquement.'}</p><form id="client-form"><div class="form-row"><label>Prénom<input name="prenom" required value="${escapeHtml(current.prenom)}" /></label><label>Nom<input name="nom" required value="${escapeHtml(current.nom)}" /></label></div><div class="form-row"><label>Ville<input name="ville" required value="${escapeHtml(current.ville)}" /></label><label>Quartier<input name="quartier" value="${escapeHtml(current.quartier)}" /></label></div><label>Téléphone<input name="phone" value="${escapeHtml(current.phone)}" /></label><div class="form-row"><label>Profession<input name="profession" value="${escapeHtml(current.profession)}" /></label><label>Nationalité<input name="nationality" value="${escapeHtml(current.nationality)}" /></label></div><label class="check piece-check"><input name="hasPiece" id="has-piece" type="checkbox" ${hasPiece ? 'checked' : ''} /> Enregistrer une pièce d’identité (facultatif)</label><div class="piece-fields ${hasPiece ? '' : 'disabled'}"><div class="form-row"><label>Type de pièce<select name="piece" ${hasPiece ? '' : 'disabled'}>${pieceOptions}</select></label><label>Numéro de la pièce<input name="identityNumber" value="${escapeHtml(current.identityNumber)}" ${hasPiece ? 'required' : 'disabled'} /></label></div><div class="form-row"><label>Recto (image ou PDF)<input name="pieceFront" type="file" accept="image/*,.pdf" ${hasPiece ? '' : 'disabled'} /></label><label>Verso (image ou PDF)<input name="pieceBack" type="file" accept="image/*,.pdf" ${hasPiece ? '' : 'disabled'} /></label></div>${frontName ? `<small class="existing-file">Recto actuel : ${escapeHtml(frontName)}</small>` : ''}${backName ? `<small class="existing-file">Verso actuel : ${escapeHtml(backName)}</small>` : ''}<label class="other-piece-field" ${current.piece === 'Autre' ? '' : 'hidden'}>Préciser le type de pièce<input name="pieceOther" value="${escapeHtml(current.pieceOther)}" ${current.piece === 'Autre' ? '' : 'disabled'} /></label></div><div class="modal-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button class="primary">${type === 'edit-client' ? 'Enregistrer les changements' : 'Enregistrer le client'}</button></div></form></div></div>`;
  }
  const current = type === 'edit-doc' ? state.docs[arguments[1]] || {} : {};
  if (type === 'document-type') {
    const currentName = typeof index === 'number' ? state.documentTypes[index] : '';
    const savedTemplate = state.documentTypeTemplates[currentName];
    const templateHtml = typeof savedTemplate === 'string' ? savedTemplate : savedTemplate?.content || '';
    const savedSourceName = typeof savedTemplate === 'object' ? savedTemplate?.sourceFileName : '';
    return `<div class="modal-backdrop"><div class="modal document-modal"><button class="modal-close" data-action="close">${icon('close')}</button><p class="eyebrow">${typeof index === 'number' ? 'MODIFIER LE TYPE' : 'NOUVEAU TYPE'}</p><h2>${typeof index === 'number' ? 'Modifier le type de document' : 'Ajouter un type de document'}</h2><form id="document-type-form"><label>Nom du type<input name="name" required maxlength="100" value="${escapeHtml(currentName)}" placeholder="Ex. Certificat de bornage" /></label><label>Contenu du document<div id="document-type-template" class="document-editor template-editor" contenteditable="true" role="textbox" aria-label="Contenu du document" aria-multiline="true" data-placeholder="Saisissez le contenu du document...">${DOMPurify.sanitize(templateHtml)}</div></label><p class="form-hint">Vous pouvez saisir le contenu ci-dessus ou importer un modèle Word (.docx). Champs automatiques : {{client.nom_complet}}, {{client.prenom}}, {{client.nom}}, {{client.numero_piece}}, {{client.adresse}}, {{client.ville}}, {{client.quartier}}, {{client.profession}}, {{client.nationalite}}, {{client.telephone}}, {{document.type}}, {{document.ville}}, {{document.date}}. Gardez chaque champ d’un seul tenant dans Word.</p><label>Importer un modèle Word (.docx)<input name="templateFile" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label><small class="file-status" id="template-file-status" aria-live="polite">${savedSourceName ? `Modèle Word enregistré : ${escapeHtml(savedSourceName)}` : ''}</small><p class="form-error" id="document-type-error" role="alert"></p><div class="modal-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button class="primary">Enregistrer</button></div></form></div></div>`;
  }
  const status = current.status || 'Brouillon';
  const display = { name: true, code: true, city: true, createdDate: true, expiryDate: true, ...(current.displayClientInfo || {}) };
  const currentClient = state.clients.find(client => client.id === current.clientId)
    || state.clients.find(client => clientFullName(client) === current.client);
  const selectedClientId = clientId || currentClient?.id || state.clients[0]?.id || '';
  const selectedClient = state.clients.find(client => client.id === selectedClientId) || currentClient || current.clientSnapshot;
  const selectedTitle = current.title || state.documentTypes[0] || '';
  const selectedCity = current.city || state.settings.city;
  const selectedDate = current.createdDate || new Date().toISOString().slice(0, 10);
  const savedContentTemplate = documentTemplateContent(selectedTitle);
  const body = current.content || (savedContentTemplate
    ? renderDocumentTemplate(savedContentTemplate, selectedClient, selectedTitle, selectedCity, selectedDate)
    : '<p>Renseignez ici les informations concernant le document.</p>');
  const attestation = current.attestation || {};
  return `<div class="modal-backdrop"><div class="modal document-modal"><button class="modal-close" data-action="close">${icon('close')}</button>
    <p class="eyebrow">${type === 'edit-doc' ? 'MODIFIER LE DOCUMENT' : 'NOUVEAU DOCUMENT'}</p>
    <h2>${type === 'edit-doc' ? 'Modifier le document' : 'Créer un document'}</h2>
    <p class="muted">Choisissez les informations et rédigez le contenu du document.</p>
    <form id="doc-form">
      <label>Type de document<select name="title">${state.documentTypes.map(x => `<option value="${escapeHtml(x)}" ${x === selectedTitle ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></label>
      <label>Client titulaire<select name="clientId" required>${state.clients.length ? state.clients.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === selectedClientId ? 'selected' : ''}>${escapeHtml(clientFullName(c))}</option>`).join('') : '<option value="">Enregistrez d’abord un client</option>'}</select></label>
      <div class="form-row"><label>Ville de création<input name="city" value="${current.city || state.settings.city}" /></label><label>Date de création<input name="createdDate" type="date" value="${current.createdDate || new Date().toISOString().slice(0, 10)}" /></label></div>
      <label>Statut du document<select name="status"><option ${status === 'Brouillon' ? 'selected' : ''}>Brouillon</option><option ${status === 'En attente' ? 'selected' : ''}>En attente</option><option ${status === 'Terminé' ? 'selected' : ''}>Terminé</option></select></label>
      <fieldset class="document-info-options"><legend>Informations du client à afficher</legend><label class="check"><input name="showName" type="checkbox" ${display.name ? 'checked' : ''} /> Nom du titulaire</label><label class="check"><input name="showCode" type="checkbox" ${display.code ? 'checked' : ''} /> Code personnel</label><label class="check"><input name="showCity" type="checkbox" ${display.city ? 'checked' : ''} /> Ville</label><label class="check"><input name="showCreatedDate" type="checkbox" ${display.createdDate ? 'checked' : ''} /> Date de création</label></fieldset>
      <label class="check"><input id="has-expiry" name="hasExpiry" type="checkbox" ${current.expiryDate ? 'checked' : ''} /> Ajouter une date d’échéance</label>
      <label class="expiry-field"><span>Date d’échéance</span><input id="expiry-date" name="expiryDate" type="date" value="${current.expiryDate || ''}" ${current.expiryDate ? '' : 'disabled'} /></label>
      ${attestationFields(attestation, 'village', isVillageAttestation(current.title), selectedClient)}
      ${attestationFields(attestation, 'cession', isCessionAttestation(current.title), selectedClient)}
      ${attestationFields(attestation, 'sale', isSaleAttestation(current.title), selectedClient)}
      <div id="standard-document-content" ${isVillageAttestation(current.title) || isCessionAttestation(current.title) || isSaleAttestation(current.title) ? 'hidden' : ''}><label>Corps du document</label><div class="editor-toolbar"><button type="button" data-format="bold"><b>G</b></button><button type="button" data-format="italic"><i>I</i></button><button type="button" data-format="underline"><u>S</u></button><button type="button" data-format="justifyLeft">左</button><button type="button" data-format="justifyCenter">↔</button><button type="button" data-format="justifyRight">右</button><button type="button" data-format="insertUnorderedList">☷</button></div><div id="document-editor" class="document-editor" contenteditable="true">${body}</div></div>
      <div class="modal-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button class="primary">${type === 'edit-doc' ? 'Enregistrer les changements' : `Générer le document ${icon('arrow')}`}</button></div>
    </form></div></div>`;
}

function documentTypesView() {
  const rows = state.documentTypes.map((name, index) => `<div class="type-row"><span>${escapeHtml(name)}</span><div><button class="action-icon edit-action" title="Modifier" aria-label="Modifier ${escapeHtml(name)}" data-action="edit-document-type" data-type-index="${index}">${icon('edit')}</button><button class="action-icon delete-action" title="Supprimer" aria-label="Supprimer ${escapeHtml(name)}" data-action="delete-document-type" data-type-index="${index}">${icon('trash')}</button></div></div>`).join('');
  return `<section class="page"><div class="page-heading"><div><p class="eyebrow">MODÈLES</p><h1>Types de documents</h1><p class="muted">Gérez les modèles proposés lors de la création de vos documents.</p></div><button class="primary" data-action="new-document-type">${icon('plus')} Ajouter un type</button></div><div class="panel document-types-panel"><div class="section-heading"><div><h2>Liste des types</h2><p>Ces types apparaissent dans le formulaire « Nouveau document ».</p></div><span class="type-count">${state.documentTypes.length} type(s)</span></div><div class="type-list">${rows || '<p class="muted empty-types">Aucun type de document enregistré.</p>'}</div></div></section>`;
}
function loginView() {
  return `<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><div class="brand-mark"><img src="${state.settings.logo || betafLogoUrl}" alt="Logo BETAF"></div><div><strong>BETAF</strong><small>STUDIO</small></div></div><h1>Connexion</h1><p>Connectez-vous à votre espace BETAF Studio.</p><form id="login-form"><label>Nom d’utilisateur<input name="username" required autocomplete="username" /></label><label>Mot de passe<input name="password" type="password" required autocomplete="current-password" /></label><p class="form-error" id="login-error" role="alert"></p><button type="submit" class="primary full-width">Se connecter</button></form></div></div>`;
}
function bindLogin() {
  const form = document.querySelector('#login-form');
  form.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('#login-error');
    submit.disabled = true;
    submit.textContent = 'Connexion...';
    errorBox.textContent = '';
    try {
      const result = await syncRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: String(data.username).trim(), password: String(data.password) })
      });
      syncConfig.token = result.token;
      syncConfig.version = result.version;
      state.currentUser = result.user;
      saveSession();
      const pendingBrowserData = browserBackup();
      const hasBrowserData = hasRecords(pendingBrowserData || localData()) || legacyUsers.length > 0;
      if (state.currentUser.role === 'admin') {
        if (hasBrowserData && !pendingBrowserData) {
          localStorage.setItem('betaf-browser-data-backup', JSON.stringify(localData()));
        }
        try {
          const migration = await syncRequest('/api/migrate-browser', {
            method: 'POST',
            body: JSON.stringify({ data: browserBackup() || localData(), users: legacyUsers })
          });
          if (migration.imported) {
            localStorage.removeItem('betaf-users');
            localStorage.removeItem('betaf-browser-data-backup');
            syncConfig.version = migration.version;
          } else if (hasBrowserData && migration.reason !== 'nothing-to-import') {
            toast('Le serveur contient déjà des données. La sauvegarde locale est conservée dans ce navigateur.');
          }
        } catch (error) {
          toast(`Import des données locales impossible : ${error.message}`);
        }
      } else if (hasBrowserData) {
        localStorage.setItem('betaf-browser-data-backup', JSON.stringify(localData()));
        toast('Connectez-vous comme administrateur pour importer les données de ce navigateur.');
      }
      await syncPull();
      render();
    } catch (error) {
      errorBox.textContent = error.message || 'Connexion impossible.';
      submit.disabled = false;
      submit.textContent = 'Se connecter';
    }
  };
}
function passwordChangeView() {
  return `<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><div class="brand-mark"><img src="${state.settings.logo || betafLogoUrl}" alt="Logo BETAF"></div><div><strong>BETAF</strong><small>STUDIO</small></div></div><h1>Nouveau mot de passe requis</h1><p>Un administrateur a réinitialisé votre compte. Choisissez un nouveau mot de passe d’au moins 12 caractères.</p><form id="forced-password-form"><label>Nouveau mot de passe<input name="new_password" type="password" minlength="12" required autocomplete="new-password" /></label><label>Confirmer le mot de passe<input name="confirm_password" type="password" minlength="12" required autocomplete="new-password" /></label><p class="form-error" id="password-error" role="alert"></p><button type="submit" class="primary full-width">Enregistrer le mot de passe</button></form></div></div>`;
}
function bindForcedPasswordChange() {
  const form = document.querySelector('#forced-password-form');
  form.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const errorBox = form.querySelector('#password-error');
    if (data.new_password !== data.confirm_password) {
      errorBox.textContent = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    try {
      const result = await syncRequest('/api/me/password', {
        method: 'PUT',
        body: JSON.stringify({ new_password: data.new_password })
      });
      state.currentUser = result.user;
      saveSession();
      render();
    } catch (error) {
      errorBox.textContent = error.message || 'Modification impossible.';
    }
  };
}
function render() {
  document.body.classList.toggle('dark-theme', state.settings.theme === 'dark');
  if (!state.currentUser) {
    document.querySelector('#app').innerHTML = loginView();
    bindLogin();
    return;
  }
  if (state.currentUser.must_change_password) {
    document.querySelector('#app').innerHTML = passwordChangeView();
    bindForcedPasswordChange();
    return;
  }
  document.querySelector('#app').innerHTML = layout(state.view === 'dashboard' ? dashboard() : state.view === 'clients' ? clients() : state.view === 'documents' ? documents() : state.view === 'document-types' ? documentTypesView() : state.view === 'history' ? history() : state.view === 'urgency' ? urgency() : settings());
  bind();
  clearInterval(dashboardClock);
  if (state.view === 'dashboard') dashboardClock = setInterval(() => { const date = document.querySelector('#dashboard-date'); if (date) date.textContent = formatDashboardDate(); }, 1000);
}
function captureVisibleSettingsDraft() {
  const city = document.querySelector('#setting-city');
  const font = document.querySelector('#setting-font');
  const intensity = document.querySelector('#setting-intensity');
  const footer = document.querySelector('#setting-footer');
  if (city) state.settings.city = city.value;
  if (font) state.settings.font = font.value;
  if (intensity) state.settings.intensity = intensity.value;
  if (footer) state.settings.footer = footer.value;
}

function bind() {
  if (state.view === 'settings' && state.currentUser?.role === 'admin' && !state.settingsLoaded) {
    state.settingsLoaded = true;
    loadAdminSettings().then(() => {
      if (state.view === 'settings') render();
    }).catch(error => {
      state.settingsLoaded = false;
      toast(`Chargement des paramètres impossible : ${error.message}`);
    });
  }
  const navigate = view => {
    if (state.view === 'settings') captureVisibleSettingsDraft();
    state.view = view;
    if (view !== 'settings') state.settingsLoaded = false;
    render();
  };
  document.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => navigate(el.dataset.nav));
  const mobileDrawer = document.querySelector('#mobile-navigation-drawer');
  document.querySelectorAll('[data-action="open-mobile-drawer"]').forEach(el => el.onclick = () => {
    if (mobileDrawer && !mobileDrawer.open) {
      mobileDrawer.showModal();
      el.setAttribute('aria-expanded', 'true');
    }
  });
  document.querySelectorAll('[data-action="close-mobile-drawer"]').forEach(el => el.onclick = () => mobileDrawer?.close());
  if (mobileDrawer) {
    mobileDrawer.onclose = () => document.querySelector('[data-action="open-mobile-drawer"]')?.setAttribute('aria-expanded', 'false');
    mobileDrawer.onclick = event => { if (event.target === mobileDrawer) mobileDrawer.close(); };
  }
  document.querySelectorAll('[data-action="new-client"]').forEach(el => el.onclick = () => showModal('new-client'));
  document.querySelectorAll('[data-action="new-doc"]').forEach(el => el.onclick = () => showModal('new-doc'));
  document.querySelectorAll('[data-action="manage-document-types"]').forEach(el => el.onclick = () => {
    state.view = 'settings';
    state.settingsSection = 'documents';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.querySelectorAll('[data-history-tab]').forEach(el => el.onclick = () => { state.historyFilter = el.dataset.historyTab; render(); });
  document.querySelectorAll('[data-action="new-document-type"]').forEach(el => el.onclick = () => showModal('document-type'));
  document.querySelectorAll('[data-action="edit-document-type"]').forEach(el => el.onclick = () => showModal('document-type', Number(el.dataset.typeIndex)));
  document.querySelectorAll('[data-action="delete-document-type"]').forEach(el => el.onclick = () => {
    const index = Number(el.dataset.typeIndex);
    const name = state.documentTypes[index];
    const used = state.docs.some(doc => doc.title === name) || state.archive.some(doc => doc.title === name);
    if (used) { toast('Impossible de supprimer un type utilisé par un document'); return; }
    if (window.confirm(`Supprimer le type « ${name} » ?`)) {
      state.documentTypes.splice(index, 1);
      delete state.documentTypeTemplates[name];
      save(); render(); toast('Type de document supprimé');
    }
  });
  document.querySelectorAll('[data-action="global-search"]').forEach(el => el.onclick = () => {
    state.view = 'clients'; render();
    document.querySelector('#client-search')?.focus();
    toast('Recherche clients ouverte');
  });
  document.querySelectorAll('[data-action="notifications"]').forEach(el => el.onclick = () => {
    state.view = 'urgency'; render(); toast('Voici les dossiers nécessitant votre attention');
  });
  document.querySelectorAll('[data-action="profile"]').forEach(el => el.onclick = () => { state.view = 'settings'; render(); });
  document.querySelectorAll('[data-action="connect-server"]').forEach(el => el.onclick = () => connectServer());
  document.querySelectorAll('[data-action="logout"]').forEach(el => el.onclick = async () => {
    try { await syncRequest('/api/logout', { method: 'POST' }); }
    catch (error) { toast(`Déconnexion du serveur impossible : ${error.message}`); }
    clearSession();
    render();
  });
  const userForm = document.querySelector('#user-form');
  if (userForm) userForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(userForm));
    const errorBox = userForm.querySelector('#user-form-error');
    try {
      await syncRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: String(data.username || '').trim(),
          fullname: String(data.fullname || '').trim(),
          email: String(data.email || '').trim() || null,
          phone: String(data.phone || '').trim() || null,
          password: String(data.password || ''),
          role: data.role
        })
      });
      state.settingsLoaded = false;
      render();
      toast('Compte créé. Le membre devra changer son mot de passe à la première connexion.');
    } catch (error) {
      errorBox.textContent = error.message || 'Création du compte impossible.';
    }
  };
  const profileForm = document.querySelector('#profile-form');
  if (profileForm) profileForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(profileForm));
    try {
      const result = await syncRequest('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          fullname: String(data.fullname || '').trim(),
          email: String(data.email || '').trim() || null,
          phone: String(data.phone || '').trim() || null
        })
      });
      state.currentUser = result.user;
      saveSession();
      render();
      toast('Profil mis à jour');
    } catch (error) {
      toast(`Modification du profil impossible : ${error.message}`);
    }
  };
  const profilePasswordForm = document.querySelector('#profile-password-form');
  if (profilePasswordForm) profilePasswordForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(profilePasswordForm));
    if (data.new_password !== data.confirm_password) return toast('Les deux nouveaux mots de passe ne correspondent pas');
    try {
      const result = await syncRequest('/api/me/password', {
        method: 'PUT',
        body: JSON.stringify({
          current_password: String(data.current_password || ''),
          new_password: String(data.new_password || '')
        })
      });
      state.currentUser = result.user;
      saveSession();
      profilePasswordForm.reset();
      render();
      toast('Mot de passe modifié');
    } catch (error) {
      toast(`Modification du mot de passe impossible : ${error.message}`);
    }
  };
  document.querySelectorAll('[data-action="change-user-role"]').forEach(el => el.onchange = async () => {
    try {
      await syncRequest(`/api/users/${encodeURIComponent(el.dataset.userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: el.value })
      });
      state.settingsLoaded = false;
      render();
      toast('Rôle du compte mis à jour');
    } catch (error) {
      toast(`Modification du rôle impossible : ${error.message}`);
      state.settingsLoaded = false;
      render();
    }
  });
  document.querySelectorAll('[data-action="toggle-user-active"]').forEach(el => el.onclick = async () => {
    const active = el.dataset.active !== 'true';
    try {
      await syncRequest(`/api/users/${encodeURIComponent(el.dataset.userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: active })
      });
      state.settingsLoaded = false;
      render();
      toast(active ? 'Compte réactivé' : 'Compte suspendu');
    } catch (error) {
      toast(`Modification du compte impossible : ${error.message}`);
    }
  });
  document.querySelectorAll('[data-action="archive-user"]').forEach(el => el.onclick = async () => {
    if (!window.confirm('Archiver ce compte ? Son historique sera conservé et sa connexion désactivée.')) return;
    try {
      await syncRequest(`/api/users/${encodeURIComponent(el.dataset.userId)}`, { method: 'DELETE' });
      state.settingsLoaded = false;
      render();
      toast('Compte archivé; son historique est conservé');
    } catch (error) {
      toast(`Archivage impossible : ${error.message}`);
    }
  });
  document.querySelectorAll('[data-action="restore-user"]').forEach(el => el.onclick = async () => {
    try {
      await syncRequest(`/api/users/${encodeURIComponent(el.dataset.userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ restore_archived: true })
      });
      state.settingsLoaded = false;
      render();
      toast('Compte restauré');
    } catch (error) {
      toast(`Restauration impossible : ${error.message}`);
    }
  });
  document.querySelectorAll('[data-action="reset-user-password"]').forEach(el => el.onclick = () => showModal('reset-user-password', el.dataset.userId));
  document.querySelectorAll('[data-action="toggle-theme"]').forEach(el => el.onclick = () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save(); render(); });
  document.querySelectorAll('[data-action="remind"]').forEach(el => el.onclick = () => {
    const phone = String(el.dataset.phone || '').replace(/\D/g, '');
    if (!phone) return toast(`Aucun numéro de téléphone enregistré pour ${el.dataset.client}`);
    const message = `Bonjour ${el.dataset.client}, nous vous informons que votre document « ${el.dataset.title} » arrive à échéance. Veuillez contacter BETAF pour son renouvellement.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  });
  document.querySelectorAll('[data-action="dismiss-urgency"]').forEach(el => el.onclick = () => {
    if (state.currentUser?.role !== 'admin') return toast('Seul un administrateur peut masquer une alerte');
    let key;
    try { key = decodeURIComponent(el.dataset.urgencyKey); } catch { return toast('Impossible d’identifier cette alerte'); }
    if (!state.docs.some(doc => urgencyKey(doc) === key)) return toast('Cette échéance n’existe plus');
    if (!window.confirm('Masquer cette alerte ? Le document restera enregistré et l’administrateur pourra rétablir l’alerte.')) return;
    if (!state.urgencyDismissals.includes(key)) state.urgencyDismissals.push(key);
    save(); render(); toast('Alerte masquée. Vous pourrez la rétablir ci-dessous.');
  });
  document.querySelectorAll('[data-action="restore-urgency"]').forEach(el => el.onclick = () => {
    if (state.currentUser?.role !== 'admin') return toast('Seul un administrateur peut rétablir une alerte');
    let key;
    try { key = decodeURIComponent(el.dataset.urgencyKey); } catch { return toast('Impossible d’identifier cette alerte'); }
    state.urgencyDismissals = state.urgencyDismissals.filter(item => item !== key);
    save(); render(); toast('Alerte rétablie');
  });
  const urgencyWindow = document.querySelector('#urgency-window');
  if (urgencyWindow) urgencyWindow.onchange = () => {
    if (state.currentUser?.role !== 'admin') return toast('Seul un administrateur peut modifier la période des alertes');
    state.settings.urgencyWindowDays = Number(urgencyWindow.value);
    save(); render(); toast(`Période d’alerte réglée sur ${urgencyWindow.value} jours`);
  };
  const setSettingsSection = section => {
    captureVisibleSettingsDraft();
    state.settingsSection = section;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  document.querySelectorAll('[data-setting-tab]').forEach(el => el.onclick = () => setSettingsSection(el.dataset.settingTab));
  document.querySelectorAll('[data-setting-select]').forEach(el => el.onchange = () => setSettingsSection(el.value));
  document.querySelectorAll('[data-action="toggle-watermark"]').forEach(el => el.onclick = () => { captureVisibleSettingsDraft(); state.settings.watermark = !state.settings.watermark; save(); render(); });
  document.querySelectorAll('[data-action="save-settings"]').forEach(el => el.onclick = () => {
    captureVisibleSettingsDraft();
    const urgencyWindow = document.querySelector('#urgency-window');
    if (urgencyWindow && state.currentUser?.role === 'admin') state.settings.urgencyWindowDays = Number(urgencyWindow.value);
    const file = document.querySelector('#logo-file')?.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => { state.settings.logo = reader.result; save(); toast('Paramètres et logo enregistrés'); render(); };
      reader.readAsDataURL(file);
    } else { save(); toast('Paramètres enregistrés'); }
  });
  document.querySelectorAll('[data-action="print-doc"]').forEach(el => el.onclick = () => printDocument(state.docs[Number(el.dataset.docIndex)]));
  document.querySelectorAll('[data-action="view-doc"]').forEach(el => el.onclick = () => showDocumentDetails(Number(el.dataset.docIndex)));
  document.querySelectorAll('[data-action="edit-doc"]').forEach(el => el.onclick = () => showModal('edit-doc', Number(el.dataset.docIndex)));
  document.querySelectorAll('[data-action="edit-client"]').forEach(el => el.onclick = () => showModal('edit-client', el.dataset.clientId));
  document.querySelectorAll('[data-action="view-client"]').forEach(el => el.onclick = () => showClientDetails(el.dataset.clientId));
  document.querySelectorAll('[data-action="sort-clients"]').forEach(el => el.onclick = () => {
    state.clientSortDirection = state.clientSortDirection === 'asc' ? 'desc' : 'asc';
    state.clients.sort((a, b) => {
      const result = `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr', { sensitivity: 'base' });
      return state.clientSortDirection === 'asc' ? result : -result;
    });
    save(); render();
  });
  document.querySelectorAll('[data-action="export-data"]').forEach(el => el.onclick = exportData);
  document.querySelectorAll('[data-action="restore-doc"]').forEach(el => el.onclick = () => {
    const [doc] = state.archive.splice(Number(el.dataset.archiveIndex), 1);
    state.docs.unshift(doc); save(); render(); toast('Document restauré');
  });
  document.querySelectorAll('[data-doc-menu]').forEach(el => el.onclick = () => {
    const index = Number(el.dataset.docMenu);
    if (window.confirm('Archiver ce document ?')) {
      const [doc] = state.docs.splice(index, 1);
      state.archive.unshift({ ...doc, deletedAt: new Date().toLocaleDateString('fr-FR') });
      save(); render(); toast('Document déplacé dans l’archive');
    }
  });
  document.querySelectorAll('[data-client-menu]').forEach(el => el.onclick = () => {
    const index = state.clients.findIndex(c => c.id === el.dataset.clientMenu);
    if (index >= 0 && window.confirm('Supprimer ce client et conserver ses données dans l’archive ?')) {
      const client = state.clients.splice(index, 1)[0];
      state.archive.unshift({ title: `Dossier client — ${client.prenom} ${client.nom}`, client: `${client.prenom} ${client.nom}`, deletedAt: new Date().toLocaleDateString('fr-FR') });
      save(); render(); toast('Client archivé');
    }
  });
  const search = document.querySelector('#client-search');
  if (search) search.oninput = () => document.querySelectorAll('tbody tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(search.value.toLowerCase()); });
  const documentSearch = document.querySelector('#document-search');
  if (documentSearch) documentSearch.oninput = () => document.querySelectorAll('tbody tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(documentSearch.value.toLowerCase()); });
}
function showDocumentDetails(index) {
  const doc = state.docs[index];
  if (!doc) return;
  const client = clientForDocument(doc) || doc.clientSnapshot;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><div class="modal document-details"><button class="modal-close" data-action="close">${icon('close')}</button><p class="eyebrow">FICHE DOCUMENT</p><h2>${escapeHtml(doc.title)}</h2><div class="details-grid"><div><b>Titulaire</b><span>${escapeHtml(clientFullName(client) || doc.client)}</span></div><div><b>Ville</b><span>${escapeHtml(doc.city || state.settings.city)}</span></div><div><b>Date de création</b><span>${escapeHtml(doc.date)}</span></div><div><b>Date d’échéance</b><span>${escapeHtml(doc.expiryDate || 'Aucune')}</span></div></div><div class="details-section"><h3>Informations du client</h3>${client ? `<div class="details-grid"><div><b>Code personnel</b><span>${escapeHtml(client.id)}</span></div><div><b>Téléphone</b><span>${escapeHtml(client.phone || 'Non renseigné')}</span></div><div><b>Adresse</b><span>${escapeHtml([client.quartier, client.ville].filter(Boolean).join(', ') || 'Non renseignée')}</span></div><div><b>Pièce d’identité</b><span>${escapeHtml([client.piece, client.identityNumber].filter(Boolean).join(' — ') || 'Non renseignée')}</span></div><div><b>Profession / nationalité</b><span>${escapeHtml([client.profession, client.nationality].filter(Boolean).join(' / ') || 'Non renseignées')}</span></div></div>` : '<p class="muted">Aucune fiche client associée.</p>'}</div><div class="details-section"><h3>Corps du document</h3><div class="document-content-preview">${doc.content || '<p class="muted">Aucun contenu renseigné.</p>'}</div></div><div class="modal-actions"><button class="secondary" data-action="close">Fermer</button><button class="secondary" data-action="print-doc" data-doc-index="${index}">Imprimer</button><button class="primary" data-action="edit-doc" data-doc-index="${index}">Modifier</button></div></div></div>`);
  const overlay = document.querySelector('.modal-backdrop:last-child');
  overlay.querySelectorAll('[data-action="close"]').forEach(button => button.onclick = () => overlay.remove());
  overlay.querySelector('[data-action="print-doc"]').onclick = () => printDocument(doc);
  overlay.querySelector('[data-action="edit-doc"]').onclick = () => { overlay.remove(); showModal('edit-doc', index); };
}
function showClientDetails(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;
  const linked = documentsForClient(state.docs, client);
  const archived = documentsForClient(state.archive.filter(doc => doc.deletedAt), client);
  const attachment = (label, data, name, side) => {
    if (!data) return '';
    const pdf = name?.toLowerCase().endsWith('.pdf');
    const preview = pdf
      ? `<iframe class="piece-preview pdf-preview" src="${data}" title="Aperçu ${label} de la pièce"></iframe>`
      : `<img class="piece-preview" src="${data}" alt="${escapeHtml(label)} de la pièce d’identité de ${escapeHtml(clientFullName(client))}">`;
    return `<div class="piece-preview-wrap"><b>${escapeHtml(label)}</b>${preview}<div class="piece-file-actions"><small>${escapeHtml(name || 'Pièce jointe')}</small><button class="secondary" data-action="download-piece" data-client-id="${escapeHtml(client.id)}" data-piece-side="${side}">Télécharger</button></div></div>`;
  };
  const frontData = client.pieceFrontFileData || client.pieceFileData || '';
  const frontName = client.pieceFrontFileName || client.pieceFileName || '';
  const pieceFiles = `${attachment('Recto', frontData, frontName, 'front')}${attachment('Verso', client.pieceBackFileData, client.pieceBackFileName, 'back')}` || '<p class="muted">Aucun fichier importé.</p>';
  const linkedRows = linked.map(doc => {
    const index = state.docs.indexOf(doc);
    return `<div class="linked-document"><span class="doc-icon">${icon('doc')}</span><div><b>${escapeHtml(doc.title)}</b><small>${escapeHtml(doc.status || 'Archivé')} · ${escapeHtml(doc.date || '')}</small></div><button class="secondary table-action" data-action="view-linked-doc" data-doc-index="${index}">Consulter</button></div>`;
  }).join('');
  const archivedRows = archived.map(doc => `<div class="linked-document"><span class="doc-icon">${icon('doc')}</span><div><b>${escapeHtml(doc.title)}</b><small>Archivé le ${escapeHtml(doc.deletedAt)}</small></div></div>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><div class="modal client-details"><button class="modal-close" data-action="close">${icon('close')}</button><p class="eyebrow">FICHE CLIENT</p><h2>${escapeHtml(clientFullName(client))}</h2><p class="muted">Code personnel : ${escapeHtml(client.id)}</p><div class="details-section"><h3>Informations personnelles</h3><div class="details-grid"><div><b>Téléphone</b><span>${escapeHtml(client.phone || 'Non renseigné')}</span></div><div><b>Ville</b><span>${escapeHtml(client.ville || 'Non renseignée')}</span></div><div><b>Quartier</b><span>${escapeHtml(client.quartier || 'Non renseigné')}</span></div><div><b>Profession</b><span>${escapeHtml(client.profession || 'Non renseignée')}</span></div><div><b>Nationalité</b><span>${escapeHtml(client.nationality || 'Non renseignée')}</span></div><div><b>Type de pièce</b><span>${escapeHtml(client.piece || 'Aucune')}</span></div><div><b>Numéro de pièce</b><span>${escapeHtml(client.identityNumber || 'Non renseigné')}</span></div></div></div><div class="details-section"><h3>Pièce d’identité</h3>${pieceFiles}</div><div class="details-section"><h3>Attestations et documents rattachés (${linked.length})</h3>${linked.length ? `<div class="linked-documents">${linkedRows}</div>` : '<p class="muted">Aucun document rattaché à ce client.</p>'}</div>${archived.length ? `<div class="details-section"><h3>Documents archivés (${archived.length})</h3><div class="linked-documents">${archivedRows}</div></div>` : ''}<div class="modal-actions"><button class="secondary" data-action="close">Fermer</button><button class="primary" data-action="new-doc-for-client" data-client-id="${escapeHtml(client.id)}">Nouveau document</button></div></div></div>`);
  const overlay = document.querySelector('.modal-backdrop:last-child');
  overlay.querySelectorAll('[data-action="close"]').forEach(button => button.onclick = () => overlay.remove());
  overlay.querySelector('[data-action="new-doc-for-client"]').onclick = () => { overlay.remove(); showModal('new-doc', null, client.id); };
  overlay.querySelectorAll('[data-action="download-piece"]').forEach(button => button.onclick = () => {
    const isBack = button.dataset.pieceSide === 'back';
    const link = document.createElement('a');
    link.href = isBack ? client.pieceBackFileData : frontData;
    link.download = isBack ? client.pieceBackFileName || 'piece-verso' : frontName || 'piece-recto';
    link.click();
  });
  overlay.querySelectorAll('[data-action="view-linked-doc"]').forEach(button => button.onclick = () => {
    const documentIndex = Number(button.dataset.docIndex);
    overlay.remove();
    showDocumentDetails(documentIndex);
  });
}
function attestationFields(attestation = {}, kind, active = false, client = null) {
  const defaults = clientAttestationDefaults(client);
  if (kind === 'sale') {
    return `<fieldset id="sale-attestation-fields" class="attestation-fields" ${active ? '' : 'hidden disabled'}>
      <legend>Informations de l’attestation de vente</legend>
      <div class="form-row"><label>Nom complet du vendeur<input name="sellerName" value="${attestationValue(attestation, 'sellerName')}" required /></label><label>Pièce d’identité du vendeur<input name="sellerIdentity" value="${attestationValue(attestation, 'sellerIdentity')}" /></label></div>
      <div class="form-row"><label>Lots vendus<input name="lots" value="${attestationValue(attestation, 'lots')}" required placeholder="Ex. 3701, 3702, 3703 et 3704" /></label><label>Numéro d’îlot<input name="block" value="${attestationValue(attestation, 'block')}" required /></label></div>
      <div class="form-row"><label>Ville du terrain<input name="landCity" value="${attestationValue(attestation, 'landCity')}" required /></label><label>Quartier<input name="neighborhood" value="${attestationValue(attestation, 'neighborhood')}" required /></label></div>
      <label>Pièce d’identité de l’acheteur<input name="buyerIdentity" value="${attestationValue(attestation, 'buyerIdentity', defaults.identityNumber)}" /></label>
      <div class="form-row"><label>Montant total (FCFA)<input name="totalAmount" value="${attestationValue(attestation, 'totalAmount')}" required /></label><label>Montant reçu (FCFA)<input name="amountReceived" value="${attestationValue(attestation, 'amountReceived')}" required /></label></div>
      <div class="form-row"><label>Reste à payer (FCFA)<input name="remainingAmount" value="${attestationValue(attestation, 'remainingAmount')}" required /></label><label>Modalités / échéancier de paiement<input name="paymentTerms" value="${attestationValue(attestation, 'paymentTerms')}" placeholder="Ex. Paiement en trois tranches depuis mars 2026" /></label></div>
      <div class="form-row"><label>Nom du géomètre<input name="surveyorName" value="${attestationValue(attestation, 'surveyorName')}" required /></label><label>Nom du témoin<input name="witnessName" value="${attestationValue(attestation, 'witnessName')}" required /></label></div>
      <label>Ville de signature<input name="signedAt" value="${attestationValue(attestation, 'signedAt')}" /></label>
    </fieldset>`;
  }
  if (kind === 'cession') {
    return `<fieldset id="cession-attestation-fields" class="attestation-fields" ${active ? '' : 'hidden disabled'}>
      <legend>Informations de l’attestation de cession</legend>
      <div class="form-row"><label>Nom complet du cédant<input name="sellerName" value="${attestationValue(attestation, 'sellerName')}" required /></label><label>Pièce d’identité du cédant<input name="sellerIdentity" value="${attestationValue(attestation, 'sellerIdentity')}" /></label></div>
      <div class="form-row"><label>Lots cédés<input name="lots" value="${attestationValue(attestation, 'lots')}" required placeholder="Ex. 833 et 835" /></label><label>Numéro d’îlot<input name="block" value="${attestationValue(attestation, 'block')}" required /></label></div>
      <div class="form-row"><label>Quartier<input name="neighborhood" value="${attestationValue(attestation, 'neighborhood')}" required /></label><label>Ville/commune du terrain<input name="landCity" value="${attestationValue(attestation, 'landCity')}" required /></label></div>
      <label>Pièce d’identité de l’acquéreur<input name="buyerIdentity" value="${attestationValue(attestation, 'buyerIdentity', defaults.identityNumber)}" /></label>
      <label>Démarches administratives<input name="administrativeTerms" value="${attestationValue(attestation, 'administrativeTerms', 'Les démarches administratives sont à la charge de l’acquéreur.')}" /></label>
      <div class="form-row"><label>Nom complet du témoin<input name="witnessName" value="${attestationValue(attestation, 'witnessName')}" required /></label><label>Ville de signature<input name="signedAt" value="${attestationValue(attestation, 'signedAt')}" /></label></div>
    </fieldset>`;
  }
  return `<fieldset id="village-attestation-fields" class="attestation-fields" ${active ? '' : 'hidden disabled'}>
    <legend>Informations de l’attestation villageoise</legend>
    <div class="form-row"><label>Département<input name="department" value="${attestationValue(attestation, 'department', 'Abengourou')}" /></label><label>Commune<input name="commune" value="${attestationValue(attestation, 'commune', 'Abengourou')}" /></label></div>
    <div class="form-row"><label>Village<input name="village" value="${attestationValue(attestation, 'village')}" required /></label><label>Nom du chef du village<input name="villageChief" value="${attestationValue(attestation, 'villageChief')}" required /></label></div>
    <div class="form-row"><label>Numéro de lot<input name="lot" value="${attestationValue(attestation, 'lot')}" required /></label><label>Numéro d’îlot<input name="block" value="${attestationValue(attestation, 'block')}" required /></label></div>
    <label>Nom du lotissement<input name="subdivision" value="${attestationValue(attestation, 'subdivision')}" required /></label>
    <div class="form-row"><label>Numéro de la pièce d’identité<input name="identityNumber" value="${attestationValue(attestation, 'identityNumber', defaults.identityNumber)}" /></label><label>Adresse du bénéficiaire<input name="address" value="${attestationValue(attestation, 'address', defaults.address)}" /></label></div>
    <div class="form-row"><label>Profession<input name="profession" value="${attestationValue(attestation, 'profession', defaults.profession)}" /></label><label>Nationalité<input name="nationality" value="${attestationValue(attestation, 'nationality', defaults.nationality)}" /></label></div>
    <div class="form-row"><label>Téléphone<input name="phone" value="${attestationValue(attestation, 'phone', defaults.phone)}" /></label><label>Nom du propriétaire du terrain<input name="landowner" value="${attestationValue(attestation, 'landowner', defaults.landowner)}" /></label></div>
  </fieldset>`;
}
function showModal(type, index, clientId) {
  document.body.insertAdjacentHTML('beforeend', modal(type, index, clientId));
  const overlay = document.querySelector('.modal-backdrop:last-child');
  overlay.querySelectorAll('[data-action="close"]').forEach(x => x.onclick = () => overlay.remove());
  const form = overlay.querySelector('form');
  if (type === 'reset-user-password') {
    form.onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const errorBox = form.querySelector('#reset-password-error');
      try {
        await syncRequest(`/api/users/${encodeURIComponent(index)}/reset-password`, {
          method: 'PUT',
          body: JSON.stringify({ temporary_password: String(data.temporary_password || '') })
        });
        state.settingsLoaded = false;
        overlay.remove();
        render();
        toast('Mot de passe provisoire défini; changement obligatoire à la prochaine connexion');
      } catch (error) {
        errorBox.textContent = error.message || 'Réinitialisation impossible.';
      }
    };
    return;
  }
  if (type === 'connect-server') {
    form.onsubmit = async e => {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const errorBox = form.querySelector('#server-connect-error');
      const data = Object.fromEntries(new FormData(form));
      const url = String(data.url || '').trim().replace(/\/$/, '');
      const username = String(data.username || '').trim();
      const password = String(data.password || '');
      if (!/^https?:\/\/.+/i.test(url)) {
        errorBox.textContent = 'Adresse invalide. Saisissez l’URL complète de l’API, par exemple https://api.votre-domaine.com.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Connexion...';
      errorBox.textContent = '';
      try {
        const response = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Le serveur a répondu avec le code ${response.status}.`);
        syncConfig.url = url;
        syncConfig.token = result.token;
        syncConfig.version = result.version;
        syncConfig.online = true;
        localStorage.setItem('betaf-sync', JSON.stringify(syncConfig));
        await syncPull();
        overlay.remove();
        render();
        toast('Connexion au serveur BETAF réussie');
      } catch (error) {
        syncConfig.online = false;
        localStorage.setItem('betaf-sync', JSON.stringify(syncConfig));
        errorBox.textContent = `Connexion impossible : ${error.message || 'vérifiez le serveur et le réseau.'}`;
        submit.disabled = false;
        submit.textContent = 'Tester et connecter';
      }
    };
    return;
  }
  const titleSelect = form.querySelector('[name="title"]');
  const clientSelect = form.querySelector('[name="clientId"]');
  const attestationFields = form.querySelector('#village-attestation-fields');
  const cessionFields = form.querySelector('#cession-attestation-fields');
  const saleFields = form.querySelector('#sale-attestation-fields');
  const standardContent = form.querySelector('#standard-document-content');
  const documentEditor = form.querySelector('#document-editor');
  const refreshDocumentTemplate = resetWhenMissing => {
    if (type === 'edit-doc' || !documentEditor || !titleSelect) return;
    const template = documentTemplateContent(titleSelect.value);
    if (!template) {
      if (resetWhenMissing) documentEditor.innerHTML = '<p>Renseignez ici les informations concernant le document.</p>';
      return;
    }
    const client = state.clients.find(item => item.id === clientSelect?.value);
    documentEditor.innerHTML = renderDocumentTemplate(
      template,
      client,
      titleSelect.value,
      form.querySelector('[name="city"]')?.value,
      form.querySelector('[name="createdDate"]')?.value
    );
  };
  const templateFileInput = form.querySelector('[name="templateFile"]');
  form.querySelector('#document-type-template')?.addEventListener('input', () => {
    form.querySelector('#document-type-error').textContent = '';
  });
  if (templateFileInput) templateFileInput.onchange = async () => {
    const file = templateFileInput.files?.[0];
    if (!file) return;
    const errorBox = form.querySelector('#document-type-error');
    const status = form.querySelector('#template-file-status');
    const templateEditor = form.querySelector('#document-type-template');
    errorBox.textContent = '';
    status.textContent = '';
    if (!file.name.toLocaleLowerCase().endsWith('.docx')) {
      errorBox.textContent = 'Sélectionnez un fichier Word au format .docx.';
      templateFileInput.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      errorBox.textContent = 'Le modèle Word ne doit pas dépasser 10 Mo.';
      templateFileInput.value = '';
      return;
    }
    status.textContent = 'Importation du modèle...';
    try {
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      templateEditor.innerHTML = DOMPurify.sanitize(result.value);
      status.textContent = `${file.name}${result.messages.length ? ` · ${result.messages.length} avertissement(s) de conversion` : ' · modèle importé'}`;
    } catch (error) {
      status.textContent = '';
      errorBox.textContent = `Importation impossible : ${error.message || 'le fichier Word est illisible.'}`;
      templateFileInput.value = '';
    }
  };
  if (clientSelect) clientSelect.onchange = () => {
    const client = state.clients.find(item => item.id === clientSelect.value);
    const defaults = clientAttestationDefaults(client);
    const values = { ...defaults, buyerIdentity: defaults.identityNumber };
    Object.entries(values).forEach(([name, value]) => {
      form.querySelectorAll(`[name="${name}"]`).forEach(input => { input.value = value; });
    });
    refreshDocumentTemplate(false);
  };
  if (titleSelect && attestationFields && cessionFields && saleFields && standardContent) {
    const updateDocumentLayout = () => {
      const isVillage = isVillageAttestation(titleSelect.value);
      const isCession = isCessionAttestation(titleSelect.value);
      const isSale = isSaleAttestation(titleSelect.value);
      attestationFields.hidden = !isVillage;
      attestationFields.disabled = !isVillage;
      cessionFields.hidden = !isCession;
      cessionFields.disabled = !isCession;
      saleFields.hidden = !isSale;
      saleFields.disabled = !isSale;
      standardContent.hidden = isVillage || isCession || isSale;
      refreshDocumentTemplate(true);
    };
    titleSelect.onchange = updateDocumentLayout;
    updateDocumentLayout();
  }
  form.querySelector('[name="city"]')?.addEventListener('change', () => refreshDocumentTemplate(false));
  form.querySelector('[name="createdDate"]')?.addEventListener('change', () => refreshDocumentTemplate(false));
  const pieceToggle = overlay.querySelector('#has-piece');
  const pieceFields = overlay.querySelector('.piece-fields');
  if (pieceToggle) pieceToggle.onchange = () => {
    const enabled = pieceToggle.checked;
    pieceFields.classList.toggle('disabled', !enabled);
    pieceFields.querySelectorAll('select,input').forEach(input => { input.disabled = !enabled; });
    const identityNumber = pieceFields.querySelector('[name="identityNumber"]');
    if (identityNumber) identityNumber.required = enabled;
  };
  const pieceType = overlay.querySelector('[name="piece"]');
  const otherPieceField = overlay.querySelector('.other-piece-field');
  if (pieceType && otherPieceField) pieceType.onchange = () => {
    const isOther = pieceType.value === 'Autre';
    otherPieceField.hidden = !isOther;
    otherPieceField.querySelector('input').disabled = !isOther || !pieceToggle?.checked;
    otherPieceField.querySelector('input').required = isOther;
  };
  if (pieceType && otherPieceField && pieceType.value === 'Autre') {
    otherPieceField.querySelector('input').disabled = !pieceToggle?.checked;
    otherPieceField.querySelector('input').required = true;
  }
  const expiryToggle = overlay.querySelector('#has-expiry');
  const expiryInput = overlay.querySelector('#expiry-date');
  if (expiryToggle && expiryInput) expiryToggle.onchange = () => { expiryInput.disabled = !expiryToggle.checked; if (!expiryToggle.checked) expiryInput.value = ''; };
  overlay.querySelectorAll('[data-format]').forEach(button => button.onclick = () => {
    overlay.querySelector('#document-editor')?.focus();
    document.execCommand(button.dataset.format, false);
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (type === 'document-type') {
      const name = String(data.name || '').trim();
      if (!name) return;
      const duplicate = state.documentTypes.some((item, itemIndex) => item.toLocaleLowerCase() === name.toLocaleLowerCase() && itemIndex !== index);
      if (duplicate) { toast('Ce type de document existe déjà'); return; }
      const oldName = typeof index === 'number' ? state.documentTypes[index] : '';
      const oldTemplate = state.documentTypeTemplates[oldName];
      const templateEditor = form.querySelector('#document-type-template');
      const templateContent = DOMPurify.sanitize(templateEditor.innerHTML);
      const hasTemplateContent = !!(templateEditor.textContent.trim() || templateContent.includes('<img'));
      const errorBox = form.querySelector('#document-type-error');
      if (typeof index !== 'number' && !hasTemplateContent) {
        errorBox.textContent = 'Ajoutez le contenu du document ou importez un modèle Word avant de créer ce type.';
        return;
      }
      if (typeof index === 'number') {
        state.documentTypes[index] = name;
        state.docs.forEach(doc => { if (doc.title === oldName) doc.title = name; });
        state.archive.forEach(doc => { if (doc.title === oldName) doc.title = name; });
      } else state.documentTypes.push(name);
      if (hasTemplateContent) {
        const uploadedFile = form.querySelector('[name="templateFile"]')?.files?.[0];
        const sourceFileName = uploadedFile?.name || oldTemplate?.sourceFileName || '';
        state.documentTypeTemplates[name] = { content: templateContent, sourceFileName };
      } else {
        delete state.documentTypeTemplates[name];
      }
      if (oldName && oldName !== name) delete state.documentTypeTemplates[oldName];
      save(); overlay.remove(); render(); toast(typeof index === 'number' ? 'Type de document modifié' : 'Type de document ajouté');
      return;
    }
    const readFileData = file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Le fichier sélectionné ne peut pas être lu.'));
      reader.onerror = () => reject(reader.error || new Error('Impossible de lire la pièce d’identité.'));
      reader.readAsDataURL(file);
    });
    const frontFile = form.querySelector('[name="pieceFront"]')?.files?.[0];
    const backFile = form.querySelector('[name="pieceBack"]')?.files?.[0];
    let frontFileData = '';
    let backFileData = '';
    try {
      if (frontFile) frontFileData = await readFileData(frontFile);
      if (backFile) backFileData = await readFileData(backFile);
    } catch (error) {
      toast(error.message || 'Impossible de lire la pièce d’identité');
      return;
    }
    const dateLabel = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const attestation = isVillageAttestation(data.title) ? {
      department: data.department || '',
      commune: data.commune || '',
      village: data.village || '',
      villageChief: data.villageChief || '',
      lot: data.lot || '',
      block: data.block || '',
      subdivision: data.subdivision || '',
      identityNumber: data.identityNumber || '',
      address: data.address || '',
      profession: data.profession || '',
      nationality: data.nationality || '',
      phone: data.phone || '',
      landowner: data.landowner || ''
    } : isCessionAttestation(data.title) ? {
      sellerName: data.sellerName || '',
      sellerIdentity: data.sellerIdentity || '',
      lots: data.lots || '',
      block: data.block || '',
      neighborhood: data.neighborhood || '',
      landCity: data.landCity || '',
      buyerIdentity: data.buyerIdentity || '',
      administrativeTerms: data.administrativeTerms || '',
      witnessName: data.witnessName || '',
      signedAt: data.signedAt || ''
    } : isSaleAttestation(data.title) ? {
      sellerName: data.sellerName || '',
      sellerIdentity: data.sellerIdentity || '',
      lots: data.lots || '',
      block: data.block || '',
      landCity: data.landCity || '',
      neighborhood: data.neighborhood || '',
      buyerIdentity: data.buyerIdentity || '',
      totalAmount: data.totalAmount || '',
      amountReceived: data.amountReceived || '',
      remainingAmount: data.remainingAmount || '',
      paymentTerms: data.paymentTerms || '',
      surveyorName: data.surveyorName || '',
      witnessName: data.witnessName || '',
      signedAt: data.signedAt || ''
    } : null;
    if (type === 'new-client') {
      const now = new Date();
      const code = `BETAF-${String(data.nom).trim().toUpperCase()}-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${now.getHours()}${String(now.getMinutes()).padStart(2, '0')}`;
      const hasPiece = form.querySelector('#has-piece').checked;
      state.clients.unshift({
        id: code,
        prenom: String(data.prenom).trim(),
        nom: String(data.nom).trim(),
        ville: String(data.ville).trim(),
        quartier: String(data.quartier || '').trim(),
        phone: String(data.phone || '').trim(),
        profession: String(data.profession || '').trim(),
        nationality: String(data.nationality || '').trim(),
        piece: hasPiece ? (data.piece === 'Autre' ? String(data.pieceOther || '').trim() : data.piece || '') : '',
        identityNumber: hasPiece ? String(data.identityNumber || '').trim() : '',
        pieceFrontFileName: hasPiece && frontFile ? frontFile.name : '',
        pieceFrontFileData: hasPiece ? frontFileData : '',
        pieceBackFileName: hasPiece && backFile ? backFile.name : '',
        pieceBackFileData: hasPiece ? backFileData : '',
        created: dateLabel
      });
      toast('Client enregistré avec succès');
    } else if (type === 'edit-client') {
      const clientIndex = state.clients.findIndex(c => c.id === index);
      if (clientIndex >= 0) {
        const oldClient = state.clients[clientIndex];
        const hasPiece = form.querySelector('#has-piece').checked;
        const updatedClient = {
          ...oldClient,
          prenom: String(data.prenom).trim(),
          nom: String(data.nom).trim(),
          ville: String(data.ville).trim(),
          quartier: String(data.quartier || '').trim(),
          phone: String(data.phone || '').trim(),
          profession: String(data.profession || '').trim(),
          nationality: String(data.nationality || '').trim(),
          piece: hasPiece ? (data.piece === 'Autre' ? String(data.pieceOther || '').trim() : data.piece || '') : '',
          identityNumber: hasPiece ? String(data.identityNumber || '').trim() : '',
          pieceFrontFileName: hasPiece ? (frontFile?.name || oldClient.pieceFrontFileName || oldClient.pieceFileName || '') : '',
          pieceFrontFileData: hasPiece ? (frontFileData || oldClient.pieceFrontFileData || oldClient.pieceFileData || '') : '',
          pieceBackFileName: hasPiece ? (backFile?.name || oldClient.pieceBackFileName || '') : '',
          pieceBackFileData: hasPiece ? (backFileData || oldClient.pieceBackFileData || '') : '',
          pieceFileName: hasPiece ? (frontFile?.name || oldClient.pieceFileName || '') : '',
          pieceFileData: hasPiece ? (frontFileData || oldClient.pieceFileData || '') : ''
        };
        state.clients[clientIndex] = updatedClient;
        state.docs.forEach(doc => {
          if (doc.clientId === oldClient.id || (!doc.clientId && doc.client === clientFullName(oldClient))) doc.client = clientFullName(updatedClient);
        });
        state.archive.forEach(doc => {
          if (doc.clientId === oldClient.id || (!doc.clientId && doc.client === clientFullName(oldClient))) doc.client = clientFullName(updatedClient);
        });
      }
      toast('Client modifié avec succès');
    } else if (type === 'edit-doc') {
      const old = state.docs[index];
      const client = state.clients.find(item => item.id === data.clientId);
      state.docs[index] = { ...old, title: data.title, client: clientFullName(client), clientId: client?.id, clientSnapshot: client ? { ...client } : old.clientSnapshot, city: data.city, status: data.status, createdDate: data.createdDate, date: data.createdDate || old.date, expiryDate: data.hasExpiry ? data.expiryDate : '', content: overlay.querySelector('#document-editor')?.innerHTML || '', attestation, displayClientInfo: { name: !!data.showName, code: !!data.showCode, city: !!data.showCity, createdDate: !!data.showCreatedDate, expiryDate: !!data.hasExpiry } };
      toast('Document modifié avec succès');
    } else {
      const client = state.clients.find(c => c.id === data.clientId);
      if (!client) return toast('Sélectionnez un client enregistré avant de créer le document');
      state.docs.unshift({ id: crypto.randomUUID(), title: data.title, client: clientFullName(client), clientId: client.id, clientSnapshot: { ...client }, status: data.status, date: data.createdDate || dateLabel, city: data.city, createdDate: data.createdDate, expiryDate: data.hasExpiry ? data.expiryDate : '', content: overlay.querySelector('#document-editor')?.innerHTML || '', attestation, displayClientInfo: { name: !!data.showName, code: !!data.showCode, city: !!data.showCity, createdDate: !!data.showCreatedDate, expiryDate: !!data.hasExpiry } });
      toast('Document généré avec succès');
    }
    save(); overlay.remove(); render();
  };
}
function printBrandHeader() {
  const logo = `<img class="betaf-logo" src="${state.settings.logo || betafLogoUrl}" alt="Logo BETAF">`;
  return `<div class="betaf-branding"><header class="betaf-header">${logo}<div class="betaf-identity"><strong>BETAF</strong><span>Bureau d’étude topographique et d’aménagement foncier</span></div></header><p class="betaf-services"><b>NOS PRESTATIONS :</b> ${services.map(escapeHtml).join(' · ')}</p></div>`;
}
function printWatermark() {
  if (!state.settings.watermark) return '';
  return `<div class="betaf-watermark" aria-hidden="true">${Array(18).fill('<span>BETAF</span>').join('')}</div>`;
}
function printBrandStyles() {
  return `.betaf-watermark{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;display:grid;grid-template-columns:repeat(3,1fr);align-content:center;gap:30mm 8mm;transform:rotate(-28deg);opacity:${Number(state.settings.intensity) / 100}}.betaf-watermark span{color:#4668ee;font:700 24pt Arial,sans-serif;text-align:center}.betaf-branding{position:relative;z-index:1;display:block;width:100%;min-width:0}.betaf-header{display:flex;width:100%;align-items:center;justify-content:center;gap:4mm;text-align:left;border-bottom:1px solid #333;padding-bottom:3mm;margin:0 auto}.betaf-logo,.betaf-logo-text{width:16mm;height:16mm;object-fit:contain}.betaf-logo-text{display:grid;place-items:center;background:#17213d;color:#fff;border-radius:2mm;font:bold 20pt Arial,sans-serif}.betaf-identity strong,.betaf-identity span{display:block}.betaf-identity strong{font:bold 16pt Arial,sans-serif;letter-spacing:2px}.betaf-identity span{font:9pt Arial,sans-serif;margin-top:1mm}.betaf-services{position:relative;z-index:1;display:block;width:100%;text-align:center;font:8.5pt Arial,sans-serif;line-height:1.4;margin:3mm auto 0}.betaf-legal{position:relative;z-index:1;display:block;width:100%;margin:6mm 0 0;padding-top:2mm;border-top:1px solid #555;text-align:center;font:8pt Arial,sans-serif;line-height:1.3}.betaf-legal, .legal {color:#586580}`;
}
function printBrandLegal() {
  return `<div class="betaf-legal">${escapeHtml(state.settings.footer || '')}</div>`;
}
function printExpandedFrameStyles() {
  return `.page:before,.sheet:before{content:"";position:absolute;inset:8.5mm;border:3px double #222;pointer-events:none;z-index:0}`;
}
function printVillageBrandHeader(attestation) {
  const logo = `<img src="${state.settings.logo || betafLogoUrl}" alt="Logo BETAF">`;
  return `<header class="village-brand"><div class="village-logo">${logo}</div><div class="village-identity"><strong>BETAF</strong><span>Bureau d’étude topographique et d’aménagement foncier</span></div><img class="village-emblem" src="${attestationSealUrl}" alt="Emblème de la République de Côte d’Ivoire"></header><p class="village-services"><b>NOS PRESTATIONS :</b> ${services.map(escapeHtml).join(' · ')}</p><section class="institution-row"><div class="institution-place"><strong>DÉPARTEMENT D’${attestationValue(attestation, 'department', 'Abengourou').toLocaleUpperCase()}</strong><span>COMMUNE D’${attestationValue(attestation, 'commune', 'Abengourou').toLocaleUpperCase()}</span></div><div class="institution-republic"><strong>RÉPUBLIQUE DE CÔTE D’IVOIRE</strong><span>Union-Discipline-Travail</span></div></section>`;
}
function printVillageAttestation(doc, client) {
  const attestation = doc.attestation || {};
  const createdDate = doc.createdDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.createdDate)
    ? new Date(`${doc.createdDate}T12:00:00`).toLocaleDateString('fr-FR')
    : doc.date;
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    toast('Autorisez les fenêtres contextuelles pour imprimer');
    return;
  }
  const beneficiary = escapeHtml(doc.client || '');
  const phone = attestationValue(attestation, 'phone', client?.phone);
  const address = attestationValue(attestation, 'address', [client?.quartier, client?.ville].filter(Boolean).join(', '));
  const identityNumber = attestationValue(attestation, 'identityNumber', client?.identityNumber);
  printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)} — BETAF</title><style>
    *{box-sizing:border-box}
    @page{size:A4 portrait;margin:0}
    html,body{margin:0;padding:0;width:210mm;font-family:"Times New Roman",serif;color:#161616}
    body{display:flex;flex-direction:column;align-items:center}
    .page{box-sizing:border-box;width:210mm;height:297mm;min-height:297mm;margin:0 auto;padding:15mm;position:relative;break-after:auto;page-break-after:auto}
    .frame{box-sizing:border-box;position:relative;z-index:2;width:100%;height:267mm;min-height:267mm;margin:0 auto;padding:3.5mm;display:flex;flex-direction:column}
    .village-brand{display:grid;grid-template-columns:23mm 1fr 27mm;align-items:center;gap:5mm;min-height:22mm;border-bottom:1px solid #4668ee;padding:0 2mm 1mm;text-align:center;color:#777}
    .village-logo{width:22mm;height:20mm;display:grid;place-items:center}
    .village-logo img{width:20mm;height:20mm;object-fit:contain}
    .village-identity strong,.village-identity span{display:block}
    .village-identity strong{font:bold 23pt "Times New Roman",serif;letter-spacing:1mm}
    .village-identity span{font:14pt "Times New Roman",serif;margin-top:1mm}
    .village-emblem{width:27mm;height:20mm;object-fit:contain}
    .village-services{margin:1mm 0 1mm;padding:0 3mm 1mm;border-bottom:1px solid #4668ee;text-align:center;color:#777;font:10pt "Times New Roman",serif;line-height:1.25}
    .institution-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:5mm;margin:0 2mm;color:#111}
    .institution-place,.institution-republic{display:flex;flex-direction:column;gap:1mm;font-size:14pt;font-style:italic;line-height:1.3}
    .institution-place{align-items:flex-start}
    .institution-place strong,.institution-republic strong{font-weight:bold}
    .institution-republic{align-items:flex-end;text-align:right}
    .institution-republic span{font-size:14pt;font-weight:normal}
    .document-heading{text-align:center;margin:3mm 0 2mm}
    .document-heading h1{font-size:25pt;line-height:1.25;text-decoration:underline;text-transform:uppercase;margin:0 0 3mm}
    .document-heading h2{font-size:20pt;margin:0}
    .parcel{text-align:center;font-size:22pt;font-weight:bold;margin:1mm 0}
    .subdivision{text-align:center;text-transform:uppercase;font-size:22pt;font-weight:bold;margin:0 0 1mm}
    .attestation-body{width:100%;font-size:22pt;line-height:1.25;text-align:justify;white-space:normal}
    .attestation-body p{width:100%;margin:0 0 2mm;text-align:justify}
    .identity-list{list-style:none;margin:2mm 0 3mm;padding:0 0 0 8mm}
    .identity-list{width:100%;padding:0;text-align:left}
    .identity-list li{width:100%;margin:1mm 0;text-align:left}
    .closing{text-indent:8mm;margin-top:2mm!important}
    .signature-row{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:15mm;margin-top:auto;padding-top:2.2mm;text-align:center;font-size:16pt;font-weight:bold}
    .signature-line{min-height:12mm}
    .signature-label{text-decoration:underline}
    .signature-name{margin-top:2mm}
    .date-line{margin-top:4mm;text-align:right;font-size:11pt;font-weight:700}
    .frame>.betaf-legal{margin-top:auto;margin-bottom:.9mm;font-size:9pt}
    @media print{html,body{width:210mm;height:297mm;margin:0}.page{height:297mm;min-height:297mm;margin:0 auto;padding:15mm}.frame{height:267mm;min-height:267mm}}
    ${printBrandStyles()}
    ${printExpandedFrameStyles()}
    .frame{position:relative;z-index:2}
  </style></head><body><main class="page">${printWatermark()}<article class="frame">
    ${printVillageBrandHeader(attestation)}
    <section class="document-heading"><h1>Attestation d’attribution villageoise</h1><h2>Portant attribution du</h2></section>
    <div class="parcel">ILOT : ${attestationValue(attestation, 'block')} &nbsp;&nbsp; LOT : ${attestationValue(attestation, 'lot')}</div>
    <p class="subdivision">Lotissement ${attestationValue(attestation, 'subdivision')}</p>
    <section class="attestation-body">
      <p>Je soussigné, <strong>${attestationValue(attestation, 'villageChief')}</strong>, Chef du village de <strong>${attestationValue(attestation, 'village')}</strong>, atteste que le lot n° <strong>${attestationValue(attestation, 'lot')}</strong>, îlot <strong>${attestationValue(attestation, 'block')}</strong>, du lotissement <strong>${attestationValue(attestation, 'subdivision')}</strong>, est attribué à :</p>
      <ul class="identity-list">
        <li><strong>M./Mme/Mlle :</strong> ${beneficiary}</li>
        <li><strong>CNI N° :</strong> ${identityNumber}</li>
        <li><strong>Adresse :</strong> ${address}</li>
        <li><strong>Profession :</strong> ${attestationValue(attestation, 'profession')}</li>
        <li><strong>Nationalité :</strong> ${attestationValue(attestation, 'nationality')}</li>
        <li><strong>Tél. :</strong> ${phone}</li>
      </ul>
      <p class="closing">En foi de quoi, nous lui délivrons la présente attestation pour servir et valoir ce que de droit.</p>
    </section>
    <footer class="signature-row">
      <div class="signature-line"><div class="signature-label">Le Propriétaire Terrain</div><div class="signature-name">${attestationValue(attestation, 'landowner')}</div></div>
      <div class="date-line">Fait à ${escapeHtml(doc.city || state.settings.city)} le : ${escapeHtml(createdDate || '')}</div>
    </footer>
    ${printBrandLegal()}
  </article></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}
function printCessionAttestation(doc, client) {
  const attestation = doc.attestation || {};
  const createdDate = doc.createdDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.createdDate)
    ? new Date(`${doc.createdDate}T12:00:00`).toLocaleDateString('fr-FR')
    : doc.date;
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    toast('Autorisez les fenêtres contextuelles pour imprimer');
    return;
  }
  const buyerIdentity = attestationValue(attestation, 'buyerIdentity', client?.identityNumber);
  const administrativeTerms = attestationValue(attestation, 'administrativeTerms', 'Les démarches administratives sont à la charge de l’acquéreur.');
  printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)} — BETAF</title><style>
    @page{size:A4 portrait;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:210mm;height:297mm;color:#171717;font-family:"Times New Roman",serif;background:#fff}
    body{display:flex;flex-direction:column;align-items:center}
    .page{box-sizing:border-box;width:210mm;height:297mm;margin:0 auto;position:relative;display:flex;flex-direction:column;padding:18.5mm;break-after:auto;page-break-after:auto}
    .attestation{box-sizing:border-box;position:relative;z-index:1;display:flex;flex:1 1 auto;flex-direction:column;min-height:0;width:100%}
    .attestation>.betaf-branding,.attestation>h1,.attestation>.body,.attestation>.place-date,.attestation>.signatures,.attestation>.betaf-legal{box-sizing:border-box;position:relative;z-index:1;width:100%;max-width:none;min-width:0;margin-left:0;margin-right:0}
    h1{text-align:center;text-transform:uppercase;text-decoration:underline;font-size:20pt;margin:8mm 0 10mm}
    .body{flex:1 1 auto;display:flex;flex-direction:column;justify-content:space-between;width:100%;min-width:0;font-size:16pt;line-height:1.6;text-align:justify}
    .body p{width:100%;margin:0;text-indent:12mm;text-align:justify}
    .body strong{font-weight:bold}
    .closing{margin-top:0!important}
    .place-date{text-align:right;font-size:12pt;margin:0;padding-top:8mm}
    .signatures{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6mm 18mm;margin:0;padding:12mm 0 4mm;text-align:center;font-size:14pt;font-weight:bold}
    .signature{min-height:24mm}
    .signature-title{text-decoration:underline}
    .signature-name{margin-top:12mm}
    .witness{grid-column:1/-1;width:50%;justify-self:center}
    .attestation>.betaf-legal{margin-top:auto}
    @media print{html,body{margin:0;padding:0;width:210mm;height:297mm}.page{margin:0 auto;padding:18.5mm}}
    ${printBrandStyles()}
    ${printExpandedFrameStyles()}
  </style></head><body><main class="page">${printWatermark()}<article class="attestation">
    ${printBrandHeader()}
    <h1>Attestation de cession</h1>
    <section class="body">
      <p><strong>${attestationValue(attestation, 'sellerName')}</strong>, titulaire de la pièce d’identité n° <strong>${attestationValue(attestation, 'sellerIdentity')}</strong>, atteste avoir cédé à titre définitif les lots n° <strong>${attestationValue(attestation, 'lots')}</strong>, îlot <strong>${attestationValue(attestation, 'block')}</strong>, sis au quartier <strong>${attestationValue(attestation, 'neighborhood')}</strong> (${attestationValue(attestation, 'landCity')}), à Monsieur/Madame <strong>${escapeHtml(doc.client || '')}</strong>, titulaire de la pièce d’identité n° <strong>${buyerIdentity}</strong>.</p>
      <p>${administrativeTerms} La transaction a été faite en présence de Monsieur/Madame <strong>${attestationValue(attestation, 'witnessName')}</strong>, témoin.</p>
      <p class="closing">En foi de quoi, la présente attestation lui a été délivrée pour servir et valoir ce que de droit.</p>
    </section>
    <div class="place-date">Fait à ${attestationValue(attestation, 'signedAt', doc.city || state.settings.city)}, le ${escapeHtml(createdDate || '')}</div>
    <footer class="signatures">
      <div class="signature"><div class="signature-title">Le cédant</div><div class="signature-name">${attestationValue(attestation, 'sellerName')}</div></div>
      <div class="signature"><div class="signature-title">L’acquéreur</div><div class="signature-name">${escapeHtml(doc.client || '')}</div></div>
      <div class="signature witness"><div class="signature-title">Le témoin</div><div class="signature-name">${attestationValue(attestation, 'witnessName')}</div></div>
    </footer>
    ${printBrandLegal()}
  </article></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}
function printSaleAttestation(doc, client) {
  const attestation = doc.attestation || {};
  const createdDate = doc.createdDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.createdDate)
    ? new Date(`${doc.createdDate}T12:00:00`).toLocaleDateString('fr-FR')
    : doc.date;
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    toast('Autorisez les fenêtres contextuelles pour imprimer');
    return;
  }
  const buyerIdentity = attestationValue(attestation, 'buyerIdentity', client?.identityNumber);
  const paymentTerms = attestationValue(attestation, 'paymentTerms');
  printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)} — BETAF</title><style>
    @page{size:A4 portrait;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:210mm;height:297mm;color:#171717;font-family:"Times New Roman",serif;background:#fff}
    body{display:flex;flex-direction:column;align-items:center}
    .page{box-sizing:border-box;width:210mm;height:297mm;margin:0 auto;position:relative;display:flex;flex-direction:column;padding:18.5mm;break-after:auto;page-break-after:auto}
    .attestation{box-sizing:border-box;position:relative;z-index:1;display:flex;flex:1 1 auto;flex-direction:column;min-height:0;width:100%}
    .attestation>.betaf-branding,.attestation>h1,.attestation>.body,.attestation>.place-date,.attestation>.signatures,.attestation>.betaf-legal{box-sizing:border-box;position:relative;z-index:1;width:100%;max-width:none;min-width:0;margin-left:0;margin-right:0}
    h1{text-align:center;text-transform:uppercase;text-decoration:underline;font-size:20pt;margin:8mm 0 10mm}
    .body{flex:1 1 auto;display:flex;flex-direction:column;justify-content:space-between;width:100%;min-width:0;font-size:16pt;line-height:1.6;text-align:justify}
    .body p{width:100%;margin:0;text-indent:12mm;text-align:justify}
    .body strong{font-weight:bold}
    .closing{margin-top:0!important}
    .place-date{text-align:right;font-size:12pt;margin:0;padding-top:8mm}
    .signatures{width:100%;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm 12mm;margin:0;padding:12mm 0 4mm;text-align:center;font-size:14pt;font-weight:bold}
    .signature{min-height:28mm}
    .signature-title{text-decoration:underline}
    .signature-name{margin-top:14mm}
    .attestation>.betaf-legal{margin-top:auto}
    @media print{html,body{margin:0;padding:0;width:210mm;height:297mm}.page{margin:0 auto;padding:18.5mm}}
    ${printBrandStyles()}
    ${printExpandedFrameStyles()}
  </style></head><body><main class="page">${printWatermark()}<article class="attestation">
    ${printBrandHeader()}
    <h1>Attestation de vente</h1>
    <section class="body">
      <p>Je soussigné(e) <strong>${attestationValue(attestation, 'sellerName')}</strong>, titulaire de la pièce d’identité n° <strong>${attestationValue(attestation, 'sellerIdentity')}</strong>, reconnais avoir reçu la somme de <strong>${attestationValue(attestation, 'amountReceived')} FCFA</strong> de la part de <strong>${escapeHtml(doc.client || '')}</strong>, titulaire de la pièce d’identité n° <strong>${buyerIdentity}</strong>, pour l’achat des lots n° <strong>${attestationValue(attestation, 'lots')}</strong> (îlot <strong>${attestationValue(attestation, 'block')}</strong>), sis à <strong>${attestationValue(attestation, 'landCity')}</strong>, au quartier <strong>${attestationValue(attestation, 'neighborhood')}</strong>.</p>
      <p>Le montant total de la vente est de <strong>${attestationValue(attestation, 'totalAmount')} FCFA</strong>. Le reste à payer est de <strong>${attestationValue(attestation, 'remainingAmount')} FCFA</strong>${paymentTerms ? `. ${paymentTerms}` : ''}</p>
      <p class="closing">En foi de quoi, je lui délivre la présente attestation pour servir et valoir ce que de droit.</p>
    </section>
    <div class="place-date">Fait à ${attestationValue(attestation, 'signedAt', doc.city || state.settings.city)}, le ${escapeHtml(createdDate || '')}</div>
    <footer class="signatures">
      <div class="signature"><div class="signature-title">Le géomètre</div><div class="signature-name">${attestationValue(attestation, 'surveyorName')}</div></div>
      <div class="signature"><div class="signature-title">Témoin</div><div class="signature-name">${attestationValue(attestation, 'witnessName')}</div></div>
      <div class="signature"><div class="signature-title">Acheteur</div><div class="signature-name">${escapeHtml(doc.client || '')}</div></div>
    </footer>
    ${printBrandLegal()}
  </article></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}
function printDocument(doc) {
  if (doc) recordAction('document-printed', `document_id=${doc.id || 'legacy'}`);
  const client = clientForDocument(doc) || doc.clientSnapshot;
  if (isVillageAttestation(doc.title)) {
    printVillageAttestation(doc, client);
    return;
  }
  if (isCessionAttestation(doc.title)) {
    printCessionAttestation(doc, client);
    return;
  }
  if (isSaleAttestation(doc.title)) {
    printSaleAttestation(doc, client);
    return;
  }
  const display = { name: true, code: true, city: true, createdDate: true, expiryDate: true, ...(doc.displayClientInfo || {}) };
  const clientName = clientFullName(client) || doc.client || '';
  const clientRows = `${display.name ? `<div class="row"><b>Client</b><span>${escapeHtml(clientName)}</span></div>` : ''}${display.code ? `<div class="row"><b>Code personnel</b><span>${escapeHtml(client?.id || '—')}</span></div>` : ''}${display.city ? `<div class="row"><b>Ville</b><span>${escapeHtml(client?.ville || doc.city || state.settings.city)}</span></div>` : ''}${display.createdDate ? `<div class="row"><b>Date de création</b><span>${escapeHtml(doc.date || '')}</span></div>` : ''}${display.expiryDate && doc.expiryDate ? `<div class="row"><b>Date d’échéance</b><span>${escapeHtml(doc.expiryDate)}</span></div>` : ''}`;
  const logo = `<img src="${state.settings.logo || betafLogoUrl}" class="print-logo" alt="BETAF">`;
  const watermark = state.settings.watermark ? `<div class="watermark">${Array(18).fill('<span>BETAF</span>').join('')}</div>` : '';
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) { toast('Autorisez les fenêtres contextuelles pour imprimer'); return; }
  printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)} — BETAF</title><style>
    @page{size:A4 portrait;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:210mm;min-height:297mm;background:#fff;color:#17213d;font-family:${state.settings.font},Arial,sans-serif}
    body{display:flex;flex-direction:column;align-items:center}
    .sheet{box-sizing:border-box;width:210mm;min-height:297mm;margin:0 auto;position:relative;display:flex;flex-direction:column;padding:18.5mm}
    .watermark{position:absolute;inset:0;overflow:hidden;display:grid;grid-template-columns:repeat(3,1fr);align-content:center;gap:35mm 12mm;transform:rotate(-28deg);opacity:${Number(state.settings.intensity) / 100};z-index:0;pointer-events:none}
    .watermark span{font-size:28px;font-weight:700;color:#4668ee;text-align:center}
    .content{position:relative;z-index:1;flex:1}
    .head{display:flex;align-items:center;justify-content:center;gap:14px;padding-bottom:10px;border-bottom:2px solid #17213d}
    .print-logo{width:58px;height:58px;object-fit:contain;display:block}
    .print-logo-text{width:58px;height:58px;background:#17213d;color:#fff;border-radius:10px;display:grid;place-items:center;font-size:32px;font-weight:800}
    .head h1{font-size:24px;letter-spacing:3px;margin:0}
    .head p{font-size:9px;color:#697591;margin:4px 0 0}
    .services{font-size:8px;line-height:1.5;color:#697591;margin:10px 0 6px;text-align:center}
    .legal{text-align:center;margin:8px 0 0;padding-top:6px;border-top:1px solid #9aa3b5;font-size:8px;line-height:1.4;color:#586580}
    .title{text-align:center;text-decoration:underline;font-size:24px;font-weight:800;margin:0 0 30px;text-transform:uppercase}
    .body{width:100%;font-size:16px;line-height:1.7;text-align:justify}
    .box{width:100%;border:1px solid #cbd2e2;padding:15px;margin:18px 0;text-align:left}
    .row{display:flex;width:100%;justify-content:space-between;gap:12px;border-bottom:1px solid #edf0f5;padding:7px 0}
    .row:last-child{border-bottom:0}
    .editor-content{width:100%;font-size:16px;line-height:1.7;text-align:left}
    .footer{font-size:9px;padding-top:8px;margin-top:12px}
    .made-at{text-align:right;margin:0 8px 2px 0;line-height:1.2}
    .signatures{display:flex;justify-content:space-between;margin-top:4px;text-align:center;font-size:10px;min-height:34mm}
    .signatures strong{text-decoration:underline}
    @media print{html,body{width:210mm;min-height:297mm;margin:0}.sheet{margin:0 auto;padding:18.5mm}}
    ${printExpandedFrameStyles()}
    </style></head><body><div class="sheet">${watermark}<div class="content"><div class="head">${logo}<div><h1>BETAF</h1><p>Bureau d’étude topographique et d’aménagement foncier</p></div></div><div class="services"><b>NOS PRESTATIONS :</b> ${services.map(escapeHtml).join(' · ')}</div><h2 class="title">${escapeHtml(doc.title)}</h2><div class="body"><div class="box">${clientRows}</div><div class="editor-content">${doc.content || '<p>Document établi par BETAF.</p>'}</div></div></div><div class="footer"><div class="made-at">Fait à ${escapeHtml(doc.city || state.settings.city)}, le ${escapeHtml(doc.date)}</div><div class="signatures"><span><strong>Le cessionnaire</strong></span><span><strong>Le Gérant</strong></span></div><div class="legal">${escapeHtml(state.settings.footer || '')}</div></div></div></body></html>`);
  printWindow.document.close(); printWindow.focus(); printWindow.onload = () => printWindow.print();
}
function exportData() {
  recordAction('data-exported');
  const blob = new Blob([JSON.stringify({ clients: state.clients, documents: state.docs, documentTypes: state.documentTypes, documentTypeTemplates: state.documentTypeTemplates, archive: state.archive, settings: state.settings }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `betaf-export-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
}
function toast(text) { const el = document.createElement('div'); el.className='toast'; el.textContent = `✓  ${text}`; document.body.append(el); setTimeout(() => el.remove(), 2600); }
async function restoreSession() {
  if (!syncConfig.token) {
    render();
    return;
  }
  try {
    const result = await syncRequest('/api/me');
    state.currentUser = result.user;
    saveSession();
    await syncPull();
    if (state.currentUser) render();
  } catch (error) {
    if (error.status === 401) clearSession();
    else state.currentUser = null;
    render();
    toast(`Connexion au serveur impossible : ${error.message}`);
  }
}
restoreSession();
