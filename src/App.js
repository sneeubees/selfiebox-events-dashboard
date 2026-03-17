import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { Authenticated, AuthLoading, Unauthenticated, useAction, useMutation, useQuery } from 'convex/react';
import { api } from './convex/_generated/api';
import { extractPlaceResult, hasGoogleMapsApiKey, loadGoogleMapsApi } from './googleMaps';
import './App.css';
import {
  BOARD_COLUMNS,
  PAYMENT_OPTIONS,
  PAYMENT_STYLES,
  PRODUCT_OPTIONS,
  PRODUCT_STYLES,
  seedEvents,
  STATUS_OPTIONS,
  STATUS_STYLES,
} from './seedData';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROLE_OPTIONS = ['admin', 'manager', 'user'];
const STATIC_COLUMN_TYPES = {
  name: 'text',
  date: 'date',
  hours: 'text',
  branch: 'multiItem',
  products: 'multiItem',
  status: 'singleItem',
  location: 'text',
  paymentStatus: 'singleItem',
  vinyl: 'singleItem',
  gsAi: 'singleItem',
  imagesSent: 'singleItem',
  snappic: 'singleItem',
  attendants: 'multiItem',
  exVat: 'number',
  packageOnly: 'number',
};
const STATIC_COLUMNS = BOARD_COLUMNS.map((column) => ({
  ...column,
  type: STATIC_COLUMN_TYPES[column.key] || 'text',
  isCustom: false,
}));
const CUSTOM_COLUMN_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'singleItem', label: 'Single item' },
  { value: 'multiItem', label: 'Multi item' },
];
const eventDefaults = {
  name: '',
  eventTitle: '',
  date: '2026-03-01',
  hours: '',
  branch: ['GP'],
  products: [],
  status: 'Quote Sent',
  location: '',
  locationPlaceId: '',
  locationLat: null,
  locationLng: null,
  paymentStatus: '50%',
  vinyl: 'No',
  gsAi: 'No',
  imagesSent: 'No',
  snappic: 'No',
  attendants: [],
  exVat: '',
  packageOnly: '',
  notes: '',
  customFields: {},
  updates: [],
  files: [],
  activity: [],
};

const defaultBranchOptions = [
  { abbreviation: 'CT', fullName: 'Cape Town', color: '#d7e5f5' },
  { abbreviation: 'KZN', fullName: 'KwaZulu-Natal', color: '#ffe1b8' },
  { abbreviation: 'GP', fullName: 'Gauteng', color: '#c8ddf7' },
];

const defaultProductOptions = PRODUCT_OPTIONS.map((fullName) => ({
  optionKey: fullName,
  abbreviation: abbreviateLabel(fullName),
  fullName,
  color: PRODUCT_STYLES[fullName]?.background || '#d9edf8',
}));

const defaultStatusOptions = STATUS_OPTIONS.map((name) => ({
  name,
  color: STATUS_STYLES[name]?.background || '#d6d6d6',
}));

const defaultPaymentOptions = PAYMENT_OPTIONS.map((name) => ({
  name,
  color: PAYMENT_STYLES[name]?.background || '#d6d6d6',
}));

const defaultYesNoOptions = [
  { name: 'Yes', color: '#2fc26d' },
  { name: 'No', color: '#d93c56' },
];

const monthAccentClass = {
  January: 'month-accent-1',
  February: 'month-accent-2',
  March: 'month-accent-3',
  April: 'month-accent-4',
  May: 'month-accent-5',
  June: 'month-accent-6',
  July: 'month-accent-7',
  August: 'month-accent-8',
  September: 'month-accent-9',
  October: 'month-accent-10',
  November: 'month-accent-11',
  December: 'month-accent-12',
};

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});

function getColumnWidth(column) {
  if (column.key === 'name') return 220;
  if (column.key === 'date') return 82;
  if (column.key === 'hours') return 110;
  if (column.key === 'branch') return 100;
  if (column.key === 'products') return 136;
  if (column.key === 'status') return 132;
  if (column.key === 'location') return 230;
  if (column.key === 'paymentStatus') return 104;
  if (column.key === 'vinyl') return 80;
  if (column.key === 'gsAi') return 86;
  if (column.key === 'imagesSent') return 102;
  if (column.key === 'snappic') return 92;
  if (column.key === 'attendants') return 120;
  if (column.key === 'exVat') return 98;
  if (column.key === 'packageOnly') return 104;
  if (column.type === 'number') return 110;
  if (column.type === 'date') return 118;
  if (column.type === 'singleItem') return 168;
  if (column.type === 'multiItem') return 146;
  return 170;
}

function serializeEventForConvex(event) {
  const workspaceYear = event.date ? new Date(event.date).getFullYear() : event.workspaceYear || 2026;
  return {
    id: event.id,
    workspaceYear,
    name: event.name || '',
    eventTitle: event.eventTitle || '',
    date: event.date || '',
    draftMonth: event.draftMonth || '',
    hours: event.hours || '',
    branch: event.branch || [],
    products: event.products || [],
    status: event.status || '',
    location: event.location || '',
    locationPlaceId: event.locationPlaceId || '',
    locationLat: typeof event.locationLat === 'number' ? event.locationLat : null,
    locationLng: typeof event.locationLng === 'number' ? event.locationLng : null,
    paymentStatus: event.paymentStatus || '',
    vinyl: event.vinyl || '',
    gsAi: event.gsAi || '',
    imagesSent: event.imagesSent || '',
    snappic: event.snappic || '',
    attendants: event.attendants || [],
    exVat: event.exVat ?? '',
    packageOnly: event.packageOnly || '',
    notes: event.notes || '',
    customFields: event.customFields || {},
    updates: event.updates || [],
    files: event.files || [],
    activity: event.activity || [],
  };
}

function DashboardApp() {

  const [events, setEvents] = useState(() => seedEvents.map((event) => ({ ...event, products: (event.products || []).map((product) => abbreviateLabel(product)) })));
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const currentUser = useQuery(api.users.current, {});
  const listedUsers = useQuery(api.users.list, currentUser?.role === 'admin' ? {} : 'skip');
  const canAccessDashboard = Boolean(currentUser?.isApproved && currentUser?.isActive);
  const workspaceRecords = useQuery(api.workspaces.list, canAccessDashboard ? {} : 'skip');
  const liveEvents = useQuery(api.events.listAll, canAccessDashboard ? {} : 'skip');
  const liveLabelOptions = useQuery(api.labels.listAll, canAccessDashboard ? {} : 'skip');
  const customColumnRecords = useQuery(api.columns.listAll, canAccessDashboard ? {} : 'skip');
  const currentColumnRights = useQuery(api.permissions.currentUserRights, canAccessDashboard ? {} : 'skip');
  const allColumnPermissions = useQuery(api.permissions.listAll, canAccessDashboard && currentUser?.role === 'admin' ? {} : 'skip');
  const syncCurrentUser = useMutation(api.users.syncCurrentUser);
  const updateMyProfile = useMutation(api.users.updateMyProfile);
  const updateMonthOrderMutation = useMutation(api.users.updateMonthOrder);
  const updateManagedUserMutation = useMutation(api.users.update);
  const removeManagedUserAction = useAction(api.adminUsers.removeWithClerk);
  const createNextWorkspaceYear = useMutation(api.workspaces.createNextYear);
  const ensureWorkspaceYear = useMutation(api.workspaces.ensureYear);
  const seedInitialEvents = useMutation(api.events.seedInitialData);
  const seedInitialLabels = useMutation(api.labels.seedInitialData);
  const migrateLegacyProductKeys = useMutation(api.labels.migrateLegacyProductKeys);
  const cleanupDuplicateLabels = useMutation(api.labels.cleanupDuplicates);
  const upsertEventMutation = useMutation(api.events.upsert);
  const removeEventMutation = useMutation(api.events.remove);
  const upsertLabelOptionMutation = useMutation(api.labels.upsert);
  const removeLabelOptionMutation = useMutation(api.labels.remove);
  const createCustomColumnMutation = useMutation(api.columns.create);
  const renameCustomColumnMutation = useMutation(api.columns.rename);
  const removeCustomColumnMutation = useMutation(api.columns.remove);
  const convertCustomColumnToSingleItemMutation = useMutation(api.columns.convertToSingleItem);
  const upsertColumnPermissionMutation = useMutation(api.permissions.upsert);
  const removeColumnPermissionMutation = useMutation(api.permissions.remove);
  const addEventUpdateMutation = useMutation(api.collaboration.addUpdate);
  const logActivityMutation = useMutation(api.collaboration.logActivity);
  const migrateLegacyCollaboration = useMutation(api.collaboration.migrateLegacyEntries);
  const deleteFutureActivityEntries = useMutation(api.collaboration.deleteFutureActivityEntries);
  const generateEventFileUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveUploadedEventFile = useMutation(api.files.saveUploadedFile);
  const removeUploadedEventFile = useMutation(api.files.removeFile);
  const migrateLegacyFiles = useMutation(api.files.migrateLegacyFiles);
  const [selectedWorkspaceYear, setSelectedWorkspaceYear] = useState(2026);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState([]);
  const [branchOptions, setBranchOptions] = useState(defaultBranchOptions);
  const [branchManagerOpen, setBranchManagerOpen] = useState(false);
  const [branchEditorEventId, setBranchEditorEventId] = useState(null);
  const [newBranchFullName, setNewBranchFullName] = useState('');
  const [newBranchAbbreviation, setNewBranchAbbreviation] = useState('');
  const [newBranchColor, setNewBranchColor] = useState('#b8d9ff');
  const [branchDrafts, setBranchDrafts] = useState({});
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [productOptions, setProductOptions] = useState(defaultProductOptions);
  const [productManagerOpen, setProductManagerOpen] = useState(false);
  const [productEditorEventId, setProductEditorEventId] = useState(null);
  const [newProductFullName, setNewProductFullName] = useState('');
  const [newProductAbbreviation, setNewProductAbbreviation] = useState('');
  const [newProductColor, setNewProductColor] = useState('#d9edf8');
  const [productDrafts, setProductDrafts] = useState({});
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [statusOptions, setStatusOptions] = useState(defaultStatusOptions);
  const [statusManagerOpen, setStatusManagerOpen] = useState(false);
  const [statusEditorEventId, setStatusEditorEventId] = useState(null);
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#23b26d');
  const [statusDrafts, setStatusDrafts] = useState({});
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [managedSingleOptions, setManagedSingleOptions] = useState({
    paymentStatus: defaultPaymentOptions,
    vinyl: defaultYesNoOptions,
    gsAi: defaultYesNoOptions,
    imagesSent: defaultYesNoOptions,
    snappic: defaultYesNoOptions,
  });
  const [managedSingleManagerKey, setManagedSingleManagerKey] = useState('');
  const [managedSingleEditor, setManagedSingleEditor] = useState({ columnKey: '', eventId: '' });
  const [newManagedOptionName, setNewManagedOptionName] = useState('');
  const [newManagedOptionColor, setNewManagedOptionColor] = useState('#d6d6d6');
  const [managedSingleDrafts, setManagedSingleDrafts] = useState({});
  const [customOptionManagerKey, setCustomOptionManagerKey] = useState('');
  const [customOptionEditor, setCustomOptionEditor] = useState({ columnKey: '', eventId: '' });
  const [newCustomOptionName, setNewCustomOptionName] = useState('');
  const [newCustomOptionColor, setNewCustomOptionColor] = useState('#d6d6d6');
  const [customOptionDrafts, setCustomOptionDrafts] = useState({});
  const [attendantOptions, setAttendantOptions] = useState(() => Array.from(new Set(seedEvents.flatMap((event) => event.attendants || []))).map((fullName) => ({ fullName })));
  const [attendantManagerOpen, setAttendantManagerOpen] = useState(false);
  const [attendantEditorEventId, setAttendantEditorEventId] = useState('');
  const [newAttendantName, setNewAttendantName] = useState('');
  const [attendantDrafts, setAttendantDrafts] = useState({});
  const [collapsedMonths, setCollapsedMonths] = useState({ January: true, February: true, March: false, April: true, May: true, June: true, July: true, August: true, September: true, October: true, November: true, December: true });
  const [monthOrder, setMonthOrder] = useState(monthNames);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [activeRowId, setActiveRowId] = useState('');
  useEffect(() => {
    if (currentUser === undefined) {
      return;
    }

    const pendingOrder = pendingMonthOrderRef.current;
    const storedOrder = currentUser && typeof window !== 'undefined'
      ? (() => {
          try {
            const raw = window.localStorage.getItem(getMonthOrderStorageKey(currentUser.id));
            const parsed = raw ? JSON.parse(raw) : null;
            return Array.isArray(parsed) && parsed.length === monthNames.length ? parsed : null;
          } catch {
            return null;
          }
        })()
      : null;

    const savedOrder = storedOrder || (currentUser?.monthOrder?.length === monthNames.length ? currentUser.monthOrder : null);

    if (savedOrder) {
      if (pendingOrder) {
        if (JSON.stringify(savedOrder) === JSON.stringify(pendingOrder)) {
          pendingMonthOrderRef.current = null;
        } else {
          return;
        }
      }
      setMonthOrder(savedOrder);
      return;
    }

    if (currentUser && !pendingOrder) {
      setMonthOrder(monthNames);
    }
  }, [currentUser]);
  const workspaceActivityEntries = useQuery(api.collaboration.listWorkspaceActivity, canAccessDashboard ? { workspaceYear: selectedWorkspaceYear } : 'skip');
  const eventUpdateEntries = useQuery(api.collaboration.listEventUpdates, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const eventActivityEntries = useQuery(api.collaboration.listEventActivity, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const eventFileEntries = useQuery(api.files.listEventFiles, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('updates');
  const [draftUpdate, setDraftUpdate] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState('text');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [locationPreview, setLocationPreview] = useState(null);
  const [editingUserId, setEditingUserId] = useState('');
  const [profileForm, setProfileForm] = useState({ firstName: '', surname: '', designation: '', email: '', role: '', profilePic: '' });
  const [managedUserForm, setManagedUserForm] = useState({ firstName: '', surname: '', designation: '', email: '', role: 'user', profilePic: '', isApproved: false });
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', confirmLabel: 'Confirm', tone: 'default' });
  const [renameDialog, setRenameDialog] = useState({ isOpen: false, columnKey: '', value: '' });
  const [dateEditor, setDateEditor] = useState({ eventId: '', columnKey: 'date', value: '' });
  const [eventForm, setEventForm] = useState({ ...eventDefaults });
  const [columnLabels, setColumnLabels] = useState(() => { const defaults = BOARD_COLUMNS.reduce((accumulator, column) => ({ ...accumulator, [column.key]: column.label }), {}); if (typeof window === 'undefined') return defaults; try { const stored = JSON.parse(window.localStorage.getItem('selfiebox-column-labels-v1') || '{}'); return { ...defaults, ...stored }; } catch { return defaults; } });
  const [adminMenuColumn, setAdminMenuColumn] = useState(null);
  const [adminMenuPosition, setAdminMenuPosition] = useState({ top: 0, left: 0 });
  const [rightsColumnKey, setRightsColumnKey] = useState('');
  const users = useMemo(() => listedUsers ?? (currentUser ? [currentUser] : []), [listedUsers, currentUser]);
  const customColumns = useMemo(() => (customColumnRecords || []).map((column) => ({ key: column.columnKey, label: column.label, type: column.type, isCustom: true })), [customColumnRecords]);
  const allColumns = useMemo(() => [...STATIC_COLUMNS, ...customColumns], [customColumns]);
  const columnVisibility = useMemo(() => Object.fromEntries(allColumns.map((column) => [column.key, true])), [allColumns]);
  const permissionsByColumn = useMemo(() => (allColumnPermissions || []).reduce((accumulator, permission) => {
    accumulator[permission.columnKey] = [...(accumulator[permission.columnKey] || []), permission];
    return accumulator;
  }, {}), [allColumnPermissions]);
  const effectiveColumnRights = useMemo(() => Object.fromEntries(allColumns.map((column) => [column.key, currentUser?.role === 'admin' ? { canView: true, canEdit: true } : (currentColumnRights?.[column.key] || { canView: true, canEdit: true })])), [allColumns, currentColumnRights, currentUser]);
  const canManageRows = effectiveColumnRights.name?.canEdit ?? true;
  const workspaceYears = useMemo(() => {
    if (workspaceRecords === undefined) {
      return [2026, 2027];
    }
    if (!workspaceRecords.length) {
      return [];
    }
    return workspaceRecords.map((workspace) => workspace.year).sort((left, right) => left - right);
  }, [workspaceRecords]);
  const boardSurfaceRef = useRef(null);
  const eventRowRefs = useRef(new Map());
  const pendingDateAnchorRef = useRef(null);
  const userSyncKeyRef = useRef('');
  const eventsSeededRef = useRef(false);
  const labelsSeededRef = useRef(false);
  const productKeysMigratedRef = useRef(false);
  const labelCleanupRef = useRef(false);
  const customColumnTypeFixRef = useRef(false);
  const pendingMonthOrderRef = useRef(null);
  const collaborationMigratedRef = useRef(false);
  const futureActivityCleanupRef = useRef(false);
  const filesMigratedRef = useRef(false);
  const eventsRef = useRef(events);
  const persistTimeoutsRef = useRef(new Map());
  const eventSyncLocksRef = useRef(new Map());
  const eventFileInputRef = useRef(null);
  const confirmResolverRef = useRef(null);

  const visibleColumns = useMemo(() => allColumns.filter((column) => columnVisibility[column.key] && (effectiveColumnRights[column.key]?.canView ?? true)), [allColumns, columnVisibility, effectiveColumnRights]);
  const customItemColumnKeys = useMemo(() => new Set(customColumns.filter((column) => ['singleItem', 'multiItem'].includes(column.type)).map((column) => column.key)), [customColumns]);
  const customItemOptionsByColumn = useMemo(() => {
    const grouped = {};
    (liveLabelOptions || []).forEach((option) => {
      if (!customItemColumnKeys.has(option.columnKey)) {
        return;
      }
      grouped[option.columnKey] = [...(grouped[option.columnKey] || []), { name: option.name, color: option.color, order: option.order, optionKey: option.optionKey }];
    });
    return Object.fromEntries(Object.entries(grouped).map(([columnKey, options]) => [columnKey, options.sort((left, right) => left.order - right.order)]));
  }, [customItemColumnKeys, liveLabelOptions]);
  const customItemStyles = useMemo(() => Object.fromEntries(Object.entries(customItemOptionsByColumn).map(([columnKey, options]) => [columnKey, Object.fromEntries(options.map((option) => [option.name, { background: option.color, color: getContrastColor(option.color) }]))])), [customItemOptionsByColumn]);
  const customSingleTagWidths = useMemo(() => Object.fromEntries(customColumns.filter((column) => column.type === 'singleItem').map((column) => {
    const longestOption = (customItemOptionsByColumn[column.key] || []).reduce((longest, option) => Math.max(longest, option.name.length), 0);
    const longestValue = events.reduce((longest, event) => {
      const value = String((event.customFields || {})[column.key] || '');
      return Math.max(longest, value.length);
    }, 0);
    const longestLabel = Math.max(longestOption, longestValue, 6);
    return [column.key, Math.max(132, Math.min(280, longestLabel * 10 + 36))];
  })), [customColumns, customItemOptionsByColumn, events]);
  const branchAbbreviations = useMemo(() => branchOptions.map((option) => option.abbreviation), [branchOptions]);
  const branchStyles = useMemo(() => Object.fromEntries(branchOptions.map((option) => [option.abbreviation, { background: option.color, color: getContrastColor(option.color) }])), [branchOptions]);
  const branchFullNames = useMemo(() => Object.fromEntries(branchOptions.map((option) => [option.abbreviation, option.fullName])), [branchOptions]);
  const selectedBranchEvent = useMemo(() => events.find((event) => event.id === branchEditorEventId) || null, [branchEditorEventId, events]);
  const productAbbreviations = useMemo(() => productOptions.map((option) => option.abbreviation), [productOptions]);
  const productStyles = useMemo(() => Object.fromEntries(productOptions.map((option) => [option.abbreviation, { background: option.color, color: getContrastColor(option.color) }])), [productOptions]);
  const productFullNames = useMemo(() => Object.fromEntries(productOptions.map((option) => [option.abbreviation, option.fullName])), [productOptions]);
  const selectedProductEvent = useMemo(() => events.find((event) => event.id === productEditorEventId) || null, [productEditorEventId, events]);
  const statusNames = useMemo(() => statusOptions.map((option) => option.name), [statusOptions]);
  const statusStyles = useMemo(() => Object.fromEntries(statusOptions.map((option) => [option.name, { background: option.color, color: getContrastColor(option.color) }])), [statusOptions]);
  const selectedStatusEvent = useMemo(() => events.find((event) => event.id === statusEditorEventId) || null, [statusEditorEventId, events]);
  const managedSingleStyles = useMemo(() => Object.fromEntries(Object.entries(managedSingleOptions).map(([columnKey, options]) => [columnKey, Object.fromEntries(options.map((option) => [option.name, { background: option.color, color: getContrastColor(option.color) }]))])), [managedSingleOptions]);
  const selectedManagedSingleEvent = useMemo(() => events.find((event) => event.id === managedSingleEditor.eventId) || null, [managedSingleEditor.eventId, events]);
  const selectedCustomOptionEvent = useMemo(() => events.find((event) => event.id === customOptionEditor.eventId) || null, [customOptionEditor.eventId, events]);
  const attendantNames = useMemo(() => attendantOptions.map((option) => option.fullName), [attendantOptions]);
  const selectedAttendantEvent = useMemo(() => events.find((event) => event.id === attendantEditorEventId) || null, [attendantEditorEventId, events]);

  const filteredEvents = useMemo(() => {
    return [...events]
      .filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear))
      .filter((event) => (search.trim() ? event.name.toLowerCase().includes(search.trim().toLowerCase()) : true))
      .filter((event) => (selectedBranches.length ? event.branch.some((item) => selectedBranches.includes(item)) : true))
      .filter((event) => (selectedProducts.length ? event.products.some((item) => selectedProducts.includes(item)) : true))
      .filter((event) => (selectedStatuses.length ? selectedStatuses.includes(event.status) : true))
      .filter((event) => (selectedPayments.length ? selectedPayments.includes(event.paymentStatus) : true))
      .sort((left, right) => sortEvents(left, right));
  }, [events, search, selectedBranches, selectedPayments, selectedProducts, selectedStatuses, selectedWorkspaceYear]);

  const eventsByMonth = useMemo(() => {
    const grouped = Object.fromEntries(monthNames.map((month) => [month, []]));
    filteredEvents.forEach((event) => {
      grouped[getEventMonth(event)].push(event);
    });
    return grouped;
  }, [filteredEvents]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedId) || null, [events, selectedId]);
  const editingUser = useMemo(() => users.find((user) => user.id === editingUserId) || null, [users, editingUserId]);
  const boardActivities = useMemo(() => (workspaceActivityEntries || []).slice().sort((left, right) => String(right.date).localeCompare(String(left.date))), [workspaceActivityEntries]);
  const selectedEventUpdates = useMemo(() => eventUpdateEntries || [], [eventUpdateEntries]);
  const selectedEventActivity = useMemo(() => eventActivityEntries || [], [eventActivityEntries]);
  const selectedEventFiles = useMemo(() => eventFileEntries || [], [eventFileEntries]);
  const highlightedRowId = dateEditor.eventId || branchEditorEventId || productEditorEventId || statusEditorEventId || managedSingleEditor.eventId || customOptionEditor.eventId || attendantEditorEventId || selectedId || activeRowId;
  const initials = currentUser ? `${currentUser.firstName?.[0] || ''}${currentUser.surname?.[0] || ''}`.toUpperCase() : 'SB';
  const nextWorkspaceYear = workspaceYears.length ? Math.max(...workspaceYears) + 1 : Number(selectedWorkspaceYear || new Date().getFullYear()) + 1;
  const selectedYearCompletedCount = events.filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear) && event.status === 'Event Completed').length;
  const orderedMonths = monthOrder.length === monthNames.length ? monthOrder : monthNames;
  const displayColumnLabel = (column) => column.isCustom ? column.label : (columnLabels[column.key] || column.label);
  const buildDefaultCustomFields = () => Object.fromEntries(customColumns.map((column) => [column.key, column.type === 'multiItem' ? [] : '']));
  const getRenderedColumnWidth = (column) => column.isCustom && column.type === 'singleItem' ? Math.max(getColumnWidth(column), (customSingleTagWidths[column.key] || 0) + 20) : getColumnWidth(column);
  const boardColumnTemplate = [...visibleColumns.map((column) => `${getRenderedColumnWidth(column)}px`), '48px'].join(' ');
  const boardWidth = visibleColumns.reduce((total, column) => total + getRenderedColumnWidth(column), 0) + 48;

  const queueActivityLog = (payload, delay = 0) => {
    window.setTimeout(() => {
      void logActivityMutation(payload).catch((error) => {
        console.error('Failed to log activity', error);
      });
    }, delay);
  };

  const requestConfirmation = ({ title = 'Confirm action', message, confirmLabel = 'Confirm', tone = 'default' }) => new Promise((resolve) => {
    confirmResolverRef.current = resolve;
    setConfirmDialog({ isOpen: true, title, message, confirmLabel, tone });
  });

  const closeConfirmation = (didConfirm) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(didConfirm);
      confirmResolverRef.current = null;
    }
    setConfirmDialog({ isOpen: false, title: '', message: '', confirmLabel: 'Confirm', tone: 'default' });
  };

  const closeRenameDialog = () => {
    setRenameDialog({ isOpen: false, columnKey: '', value: '' });
  };

  const saveRenamedColumn = async () => {
    const trimmedLabel = renameDialog.value.trim();
    if (!trimmedLabel) {
      return;
    }
    if (customColumns.some((column) => column.key === renameDialog.columnKey)) {
      try {
        await renameCustomColumnMutation({ columnKey: renameDialog.columnKey, label: trimmedLabel });
      } catch (error) {
        console.error('Failed to rename custom column', error);
        window.alert('The column name could not be saved. Please try again.');
        return;
      }
      closeRenameDialog();
      return;
    }
    setColumnLabels((current) => {
      const next = { ...current, [renameDialog.columnKey]: trimmedLabel };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('selfiebox-column-labels-v1', JSON.stringify(next));
      }
      return next;
    });
    closeRenameDialog();
  };

  const setEventRowRef = (eventId, node) => {
    if (node) {
      eventRowRefs.current.set(eventId, node);
      return;
    }

    eventRowRefs.current.delete(eventId);
  };

  useLayoutEffect(() => {
    const pendingAnchor = pendingDateAnchorRef.current;
    if (!pendingAnchor) {
      return;
    }

    const surface = boardSurfaceRef.current;
    const row = eventRowRefs.current.get(pendingAnchor.eventId);
    if (!surface || !row) {
      pendingDateAnchorRef.current = null;
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const currentOffset = rowRect.top - surfaceRect.top;
    surface.scrollTop += currentOffset - pendingAnchor.offsetTop;
    pendingDateAnchorRef.current = null;
  }, [events, selectedWorkspaceYear]);

  useEffect(() => {
    if (showProfileModal && currentUser) {
      setProfileForm({
        firstName: currentUser.firstName || '',
        surname: currentUser.surname || '',
        designation: currentUser.designation || '',
        email: currentUser.email || '',
        role: formatRole(currentUser.role || ''),
        profilePic: currentUser.profilePic || '',
      });
    }
  }, [showProfileModal, currentUser]);

  useEffect(() => {
    if (!clerkUser) {
      userSyncKeyRef.current = '';
      return;
    }

    const email = clerkUser.primaryEmailAddress?.emailAddress || '';
    if (!email) {
      return;
    }

    if (currentUser) {
      userSyncKeyRef.current = clerkUser.id;
      return;
    }

    if (userSyncKeyRef.current === clerkUser.id) {
      return;
    }

    userSyncKeyRef.current = clerkUser.id;
    void syncCurrentUser({
      email,
      firstName: clerkUser.firstName || 'New',
      surname: clerkUser.lastName || 'User',
      profilePic: clerkUser.imageUrl || '',
    }).catch((error) => {
      console.error('Failed to sync current user', error);
      userSyncKeyRef.current = '';
    });
  }, [clerkUser, currentUser, syncCurrentUser]);


  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (liveEvents === undefined) {
      return;
    }

    const now = Date.now();
    const localById = new Map(eventsRef.current.map((event) => [event.id, event]));
    const remoteIds = new Set();
    const mergedEvents = [];

    for (const [eventId, lock] of eventSyncLocksRef.current.entries()) {
      if (lock.expiresAt <= now) {
        eventSyncLocksRef.current.delete(eventId);
      }
    }

    liveEvents.forEach((event) => {
      remoteIds.add(event.id);
      const lock = eventSyncLocksRef.current.get(event.id);
      if (lock?.deleted) {
        return;
      }
      if (lock && localById.has(event.id)) {
        mergedEvents.push(localById.get(event.id));
        return;
      }
      mergedEvents.push({ ...event });
    });

    eventSyncLocksRef.current.forEach((lock, eventId) => {
      if (!lock.deleted && !remoteIds.has(eventId) && localById.has(eventId)) {
        mergedEvents.push(localById.get(eventId));
      }
    });

    eventsSeededRef.current = true;
    eventsRef.current = mergedEvents;
    setEvents(mergedEvents);
  }, [liveEvents]);

  useEffect(() => {
    if (!canAccessDashboard || liveEvents === undefined || liveEvents.length || eventsSeededRef.current) {
      return;
    }

    eventsSeededRef.current = true;
    void seedInitialEvents().catch((error) => {
      console.error('Failed to seed initial events', error);
      eventsSeededRef.current = false;
    });
  }, [canAccessDashboard, liveEvents, seedInitialEvents]);

  useEffect(() => {
    if (!canAccessDashboard || liveEvents === undefined || collaborationMigratedRef.current) {
      return;
    }

    collaborationMigratedRef.current = true;
    void migrateLegacyCollaboration().catch((error) => {
      console.error('Failed to migrate legacy collaboration', error);
      collaborationMigratedRef.current = false;
    });
  }, [canAccessDashboard, liveEvents, migrateLegacyCollaboration]);

  useEffect(() => {
    if (!canAccessDashboard || !currentUser || currentUser.role !== 'admin' || futureActivityCleanupRef.current) {
      return;
    }

    futureActivityCleanupRef.current = true;
    void deleteFutureActivityEntries().catch((error) => {
      console.error('Failed to clean future activity entries', error);
      futureActivityCleanupRef.current = false;
    });
  }, [canAccessDashboard, currentUser, deleteFutureActivityEntries]);

  useEffect(() => {
    if (!canAccessDashboard || liveEvents === undefined || filesMigratedRef.current) {
      return;
    }

    filesMigratedRef.current = true;
    void migrateLegacyFiles().catch((error) => {
      console.error('Failed to migrate legacy files', error);
      filesMigratedRef.current = false;
    });
  }, [canAccessDashboard, liveEvents, migrateLegacyFiles]);

  useEffect(() => {
    if (!canAccessDashboard || liveLabelOptions === undefined || liveLabelOptions.length || labelsSeededRef.current) {
      return;
    }

    labelsSeededRef.current = true;
    void seedInitialLabels().catch((error) => {
      console.error('Failed to seed initial labels', error);
      labelsSeededRef.current = false;
    });
  }, [canAccessDashboard, liveLabelOptions, seedInitialLabels]);

  useEffect(() => {
    if (!canAccessDashboard || liveLabelOptions === undefined || productKeysMigratedRef.current) {
      return;
    }

    productKeysMigratedRef.current = true;
    void migrateLegacyProductKeys().catch((error) => {
      console.error('Failed to migrate legacy product keys', error);
      productKeysMigratedRef.current = false;
    });
  }, [canAccessDashboard, liveLabelOptions, migrateLegacyProductKeys]);

  useEffect(() => {
    if (!canAccessDashboard || liveLabelOptions === undefined || labelCleanupRef.current) {
      return;
    }

    labelCleanupRef.current = true;
    void cleanupDuplicateLabels().catch((error) => {
      console.error('Failed to clean duplicate labels', error);
      labelCleanupRef.current = false;
    });
  }, [canAccessDashboard, liveLabelOptions, cleanupDuplicateLabels]);

  useEffect(() => {
    if (!canAccessDashboard || !currentUser || currentUser.role !== 'admin' || !customColumnRecords || customColumnTypeFixRef.current) {
      return;
    }

    const targetColumn = customColumnRecords.find((column) => column.label.trim().toUpperCase() === 'TEMPLATE DESIGN' && column.type === 'multiItem');
    if (!targetColumn) {
      return;
    }

    customColumnTypeFixRef.current = true;
    void convertCustomColumnToSingleItemMutation({ columnKey: targetColumn.columnKey }).catch((error) => {
      console.error('Failed to convert TEMPLATE DESIGN to single item', error);
      customColumnTypeFixRef.current = false;
    });
  }, [canAccessDashboard, currentUser, customColumnRecords, convertCustomColumnToSingleItemMutation]);

  useEffect(() => {
    if (liveLabelOptions === undefined) {
      return;
    }

    const byColumn = liveLabelOptions.reduce((accumulator, option) => {
      accumulator[option.columnKey] = [...(accumulator[option.columnKey] || []), option];
      return accumulator;
    }, {});
    const sortByOrder = (left, right) => left.order - right.order;

    const branch = (byColumn.branch || []).slice().sort(sortByOrder).map((option) => ({ abbreviation: option.abbreviation || option.optionKey, fullName: option.name, color: option.color }));
    const products = (byColumn.products || []).slice().sort(sortByOrder).map((option) => ({ optionKey: option.optionKey, abbreviation: option.abbreviation || abbreviateLabel(option.name || option.optionKey), fullName: sanitizeProductLabel(option.name), color: option.color }));
    const status = (byColumn.status || []).slice().sort(sortByOrder).map((option) => ({ name: option.name, color: option.color }));
    const attendants = (byColumn.attendants || []).slice().sort(sortByOrder).map((option) => ({ fullName: option.name }));

    if (branch.length) setBranchOptions(branch);
    if (products.length) setProductOptions(products);
    if (status.length) setStatusOptions(status);
    if (attendants.length) setAttendantOptions(attendants);

    setManagedSingleOptions((current) => ({
      paymentStatus: (byColumn.paymentStatus || []).length ? (byColumn.paymentStatus || []).slice().sort(sortByOrder).map((option) => ({ name: option.name, color: option.color })) : current.paymentStatus,
      vinyl: (byColumn.vinyl || []).length ? (byColumn.vinyl || []).slice().sort(sortByOrder).map((option) => ({ name: option.name, color: option.color })) : current.vinyl,
      gsAi: (byColumn.gsAi || []).length ? (byColumn.gsAi || []).slice().sort(sortByOrder).map((option) => ({ name: option.name, color: option.color })) : current.gsAi,
      imagesSent: (byColumn.imagesSent || []).length ? (byColumn.imagesSent || []).slice().sort(sortByOrder).map((option) => ({ name: option.name, color: option.color })) : current.imagesSent,
      snappic: (byColumn.snappic || []).length ? (byColumn.snappic || []).slice().sort(sortByOrder).map((option) => ({ name: option.name, color: option.color })) : current.snappic,
    }));
  }, [liveLabelOptions]);

  useEffect(() => {
    if (workspaceYears.length && !workspaceYears.includes(selectedWorkspaceYear)) {
      setSelectedWorkspaceYear(workspaceYears[0]);
    }
  }, [workspaceYears, selectedWorkspaceYear]);

  useEffect(() => {
    if (editingUser) {
      setManagedUserForm({
        firstName: editingUser.firstName || '',
        surname: editingUser.surname || '',
        designation: editingUser.designation || '',
        email: editingUser.email || '',
        role: editingUser.role || 'user',
        profilePic: editingUser.profilePic || '',
        isApproved: Boolean(editingUser.isApproved),
      });
    }
  }, [editingUser]);

  useEffect(() => {
    if (!adminMenuColumn) {
      return undefined;
    }

    const closeMenu = () => setAdminMenuColumn(null);
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('scroll', closeMenu, true);

    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, [adminMenuColumn]);

  const persistLabelOption = (columnKey, optionKey, name, abbreviation, color, order) => {
    void upsertLabelOptionMutation({ columnKey, optionKey, name, abbreviation: abbreviation || '', color, order }).catch((error) => {
      console.error('Failed to persist label option', error);
    });
  };

  const removeLabelOption = (columnKey, optionKey) => {
    void removeLabelOptionMutation({ columnKey, optionKey }).catch((error) => {
      console.error('Failed to delete label option', error);
    });
  };

  const persistEvent = (event) => {
    const pendingTimeout = persistTimeoutsRef.current.get(event.id);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      persistTimeoutsRef.current.delete(event.id);
      void upsertEventMutation({ event: serializeEventForConvex(event) }).catch((error) => {
        console.error('Failed to persist event', error);
      });
    }, 250);

    persistTimeoutsRef.current.set(event.id, timeoutId);
  };

  const replaceEvents = (updater) => {
    const previousEvents = eventsRef.current;
    const nextEvents = updater(previousEvents);
    const previousById = new Map(previousEvents.map((event) => [event.id, event]));
    const nextIds = new Set(nextEvents.map((event) => event.id));
    const changedEvents = [];
    const now = Date.now();

    nextEvents.forEach((event) => {
      const previousEvent = previousById.get(event.id);
      const hasChanged = !previousEvent || JSON.stringify(previousEvent) !== JSON.stringify(event);
      if (hasChanged) {
        changedEvents.push(event);
        eventSyncLocksRef.current.set(event.id, { expiresAt: now + 2000, deleted: false });
      }
    });

    previousEvents.forEach((event) => {
      if (!nextIds.has(event.id)) {
        eventSyncLocksRef.current.set(event.id, { expiresAt: now + 2000, deleted: true });
      }
    });

    eventsRef.current = nextEvents;
    setEvents(nextEvents);

    changedEvents.forEach((event) => {
      persistEvent(event);
    });

    previousEvents.forEach((event) => {
      if (!nextIds.has(event.id)) {
        const pendingTimeout = persistTimeoutsRef.current.get(event.id);
        if (pendingTimeout) {
          clearTimeout(pendingTimeout);
          persistTimeoutsRef.current.delete(event.id);
        }
        void removeEventMutation({ eventId: event.id }).catch((error) => {
          console.error('Failed to delete event', error);
        });
      }
    });
  };

  const updateEvent = (eventId, updater) => {
    replaceEvents((current) => current.map((event) => (event.id === eventId ? updater(event) : event)));
  };

  const updateEventField = (eventId, key, value) => {
    updateEvent(eventId, (event) => ({ ...event, [key]: value }));
  };

  const updateEventLocationText = (eventId, value) => {
    updateEvent(eventId, (event) => ({
      ...event,
      location: value,
      locationPlaceId: '',
      locationLat: null,
      locationLng: null,
    }));
  };

  const applyEventLocation = (eventId, nextLocation) => {
    updateEvent(eventId, (event) => ({
      ...event,
      location: nextLocation.location || '',
      locationPlaceId: nextLocation.locationPlaceId || '',
      locationLat: typeof nextLocation.locationLat === 'number' ? nextLocation.locationLat : null,
      locationLng: typeof nextLocation.locationLng === 'number' ? nextLocation.locationLng : null,
    }));
  };

  const updateEventCustomField = (eventId, key, value) => {
    updateEvent(eventId, (event) => ({
      ...event,
      customFields: { ...(event.customFields || {}), [key]: value },
    }));
  };


  const openDrawer = (eventId) => {
    setActiveRowId(eventId);
    setSelectedId(eventId);
    setDrawerTab('updates');
    setDrawerOpen(true);
    setDraftUpdate('');
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedId('');
    setDraftUpdate('');
  };
  const saveQuickUpdate = async () => {
    if (!selectedEvent || !draftUpdate.trim()) {
      return;
    }

    const nextBody = draftUpdate.trim();
    setDraftUpdate('');

    try {
      await addEventUpdateMutation({ eventKey: selectedEvent.id, body: nextBody });
    } catch (error) {
      console.error('Failed to save update', error);
      setDraftUpdate(nextBody);
    }
  };

  const openEventFilePicker = () => {
    eventFileInputRef.current?.click();
  };

  const handleEventFileSelection = async (changeEvent) => {
    const file = changeEvent.target.files?.[0];
    if (!selectedEvent || !file) {
      return;
    }

    try {
      const uploadUrl = await generateEventFileUploadUrl({});
      const uploadResult = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!uploadResult.ok) {
        throw new Error('Upload failed');
      }

      const { storageId } = await uploadResult.json();
      await saveUploadedEventFile({
        eventKey: selectedEvent.id,
        storageId,
        name: file.name,
        contentType: file.type || '',
        sizeLabel: formatFileSize(file.size),
      });
    } catch (error) {
      console.error('Failed to upload file', error);
      window.alert('The file could not be uploaded. Please try again.');
    } finally {
      changeEvent.target.value = '';
    }
  };

  const deleteEventFile = async (fileId) => {
    const shouldDelete = await requestConfirmation({ title: 'Delete file', message: 'Delete this file?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }

    try {
      await removeUploadedEventFile({ fileId });
      setPreviewFile((current) => (current?.id === fileId ? null : current));
    } catch (error) {
      console.error('Failed to delete file', error);
      window.alert('The file could not be deleted. Please try again.');
    }
  };

  const openEventFilePreview = (file) => {
    if (!file?.url) {
      return;
    }
    setPreviewFile(file);
  };

  const closeEventFilePreview = () => {
    setPreviewFile(null);
  };

  const openLocationPreview = (eventOrLocation) => {
    const latitude = typeof eventOrLocation?.locationLat === 'number' ? eventOrLocation.locationLat : null;
    const longitude = typeof eventOrLocation?.locationLng === 'number' ? eventOrLocation.locationLng : null;
    if (latitude == null || longitude == null) {
      return;
    }

    setLocationPreview({
      title: eventOrLocation.name || 'Event location',
      address: eventOrLocation.location || '',
      locationLat: latitude,
      locationLng: longitude,
    });
  };

  const closeLocationPreview = () => {
    setLocationPreview(null);
  };

  const duplicateEvent = async (eventId) => {
    const shouldDuplicate = await requestConfirmation({ title: 'Duplicate event', message: 'Duplicate this event?', confirmLabel: 'Duplicate' });
    if (!shouldDuplicate) {
      return;
    }

    replaceEvents((current) => {
      const index = current.findIndex((event) => event.id === eventId);
      if (index === -1) {
        return current;
      }
      const source = current[index];
      const copy = {
        ...source,
        id: `evt-${Date.now()}`,
        name: `Copy: ${source.name || 'Untitled event'}`,
        updates: [...(source.updates || [])],
        files: [...(source.files || [])],
        activity: [...(source.activity || [])],
      };
      const next = [...current];
      next.splice(index + 1, 0, copy);
      queueActivityLog({
        workspaceYear: copy.workspaceYear || selectedWorkspaceYear,
        eventKey: copy.id,
        eventName: copy.name || 'Untitled event',
        text: 'Duplicated from an existing event.',
      }, 500);
      return next;
    });
  };

  const deleteEvent = async (eventId) => {
    const shouldDelete = await requestConfirmation({ title: 'Delete event', message: 'Delete this event?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    const deletedEvent = eventsRef.current.find((event) => event.id === eventId);
    if (deletedEvent) {
      queueActivityLog({
        workspaceYear: deletedEvent.workspaceYear || selectedWorkspaceYear,
        eventName: deletedEvent.name || 'Untitled event',
        text: 'Deleted event.',
      });
    }
    replaceEvents((current) => current.filter((event) => event.id !== eventId));
    if (selectedId === eventId) {
      closeDrawer();
    }
  };

  const addBlankEvent = (monthName) => {
    const newEvent = {
      ...eventDefaults,
      id: `evt-${Date.now()}`,
      date: '',
      draftMonth: monthName,
      workspaceYear: selectedWorkspaceYear,
      customFields: buildDefaultCustomFields(),
      activity: [],
    };
    replaceEvents((current) => [...current, newEvent]);
    queueActivityLog({
      workspaceYear: selectedWorkspaceYear,
      eventKey: newEvent.id,
      eventName: newEvent.name || 'Untitled event',
      text: `Added blank event line for ${monthName}.`,
    }, 500);
    setCollapsedMonths((current) => ({ ...current, [monthName]: false }));
  };

  const openDateEditor = (eventItem, columnKey = 'date') => {
    setActiveRowId(eventItem.id);
    const monthName = getEventMonth(eventItem);
    const defaultMonthIndex = Math.max(monthNames.indexOf(monthName), 0) + 1;
    const currentValue = columnKey === 'date' ? eventItem.date : (eventItem.customFields || {})[columnKey];
    const defaultValue = currentValue || (selectedWorkspaceYear + '-' + String(defaultMonthIndex).padStart(2, '0') + '-01');
    setDateEditor({ eventId: eventItem.id, columnKey, value: defaultValue });
  };

  const closeDateEditor = () => {
    setDateEditor({ eventId: '', columnKey: 'date', value: '' });
  };

  const applyEventDate = async (eventId, nextDateValue, columnKey = 'date') => {
    const surface = boardSurfaceRef.current;
    const row = eventRowRefs.current.get(eventId);
    if (surface && row) {
      pendingDateAnchorRef.current = {
        eventId,
        offsetTop: row.getBoundingClientRect().top - surface.getBoundingClientRect().top,
      };
    }

    if (!nextDateValue) {
      setDateEditor({ eventId: '', columnKey: 'date', value: '' });
      return;
    }
    const nextDate = new Date(nextDateValue);
    const nextYear = nextDate.getFullYear();
    const nextMonthName = monthNames[nextDate.getMonth()];
    const hasWorkspace = workspaceYears.includes(nextYear);

    if (!hasWorkspace) {
      const shouldCreate = await requestConfirmation({ title: 'Create workspace', message: 'Create ' + nextYear + ' board/workspace for this date?', confirmLabel: 'Create' });
      if (!shouldCreate) {
        return;
      }
      await ensureWorkspaceYear({ year: nextYear });
    }

    if (columnKey !== 'date') {
      updateEventCustomField(eventId, columnKey, nextDateValue);
      setDateEditor({ eventId: '', columnKey: 'date', value: '' });
      return;
    }

    updateEvent(eventId, (event) => ({
      ...event,
      date: nextDateValue,
      workspaceYear: nextYear,
      draftMonth: nextMonthName,
    }));
    setCollapsedMonths((current) => ({ ...current, [nextMonthName]: false }));
    setSelectedWorkspaceYear(nextYear);
    setDateEditor({ eventId: '', columnKey: 'date', value: '' });
  };

  const handleAddEvent = (submitEvent) => {
    submitEvent.preventDefault();
    const newEvent = {
      ...eventDefaults,
      id: `evt-${String(events.length + 1).padStart(3, '0')}`,
      name: eventForm.name,
      date: eventForm.date,
      hours: eventForm.hours,
      branch: [eventForm.branch[0] || 'GP'],
      products: eventForm.products[0] ? [eventForm.products[0]] : [],
      status: eventForm.status,
      location: eventForm.location,
      paymentStatus: eventForm.paymentStatus,
      vinyl: eventForm.vinyl,
      gsAi: eventForm.gsAi,
      imagesSent: eventForm.imagesSent,
      snappic: eventForm.snappic,
      attendants: eventForm.attendants,
      exVat: eventForm.exVat,
      packageOnly: eventForm.packageOnly,
      customFields: buildDefaultCustomFields(),
      activity: [],
    };
    replaceEvents((current) => [newEvent, ...current]);
    queueActivityLog({
      workspaceYear: new Date(newEvent.date).getFullYear(),
      eventKey: newEvent.id,
      eventName: newEvent.name || 'Untitled event',
      text: 'Created event.',
    }, 500);
    setShowAddModal(false);
    setEventForm({ ...eventDefaults });
    openDrawer(newEvent.id);
  };

  const handleCreateWorkspace = async (submitEvent) => {
    submitEvent?.preventDefault?.();
    const createdWorkspace = await createNextWorkspaceYear({});
    setSelectedWorkspaceYear(createdWorkspace.year);
    setShowWorkspaceModal(false);
  };

  const exportWorkspaceToExcel = () => {
    const workspaceEvents = [...events]
      .filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear))
      .sort(sortEvents);

    const sheets = monthNames.map((month) => ({
      name: month,
      rows: workspaceEvents
        .filter((event) => getEventMonth(event) === month)
        .map((event) => visibleColumns.map((column) => formatExportValue(column.key, event, { branchFullNames, productFullNames, column }))),
    }));

    const workbookXml = buildWorkbookXml({
      sheets,
      headers: visibleColumns.map((column) => displayColumnLabel(column)),
    });

    downloadWorkbookFile(`selfiebox-events-${selectedWorkspaceYear}.xls`, workbookXml);
  };

  const handleProfileImageChange = (changeEvent, setter) => {
    const file = changeEvent.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > 1024 * 1024) {
      window.alert('Profile images must be 1 MB or smaller.');
      changeEvent.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setter((current) => ({ ...current, profilePic: String(reader.result || '') }));
      changeEvent.target.value = '';
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!currentUser) {
      return;
    }

    await updateMyProfile({
      firstName: profileForm.firstName.trim() || currentUser.firstName,
      surname: profileForm.surname.trim() || currentUser.surname,
      designation: profileForm.designation.trim() || currentUser.designation,
      profilePic: profileForm.profilePic || '',
    });
    setShowProfileModal(false);
  };

  const openUserEditor = (userId) => {
    setEditingUserId(userId);
  };

  const saveManagedUser = async () => {
    if (!editingUser) {
      return;
    }

    await updateManagedUserMutation({
      userId: editingUser.id,
      firstName: managedUserForm.firstName.trim() || editingUser.firstName,
      surname: managedUserForm.surname.trim() || editingUser.surname,
      designation: managedUserForm.designation.trim() || editingUser.designation,
      email: managedUserForm.email.trim() || editingUser.email,
      role: managedUserForm.role,
      profilePic: managedUserForm.profilePic || '',
      isApproved: Boolean(managedUserForm.isApproved),
    });
    setEditingUserId('');
  };

  const deleteManagedUser = async () => {
    if (!editingUser) {
      return;
    }

    const shouldDelete = await requestConfirmation({ title: 'Delete user', message: `Delete ${editingUser.firstName} ${editingUser.surname}?`, confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }

    await removeManagedUserAction({ userId: editingUser.id });
    setEditingUserId('');
    setShowUsersModal(false);
  };

  const toggleMonth = (month) => setCollapsedMonths((current) => ({ ...current, [month]: !current[month] }));
  const moveMonth = async (month, direction) => {
    const currentIndex = monthOrder.indexOf(month);
    const targetIndex = currentIndex + direction;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= monthOrder.length) {
      return;
    }
    const nextOrder = [...monthOrder];
    const [movedMonth] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(targetIndex, 0, movedMonth);
    pendingMonthOrderRef.current = nextOrder;
    setMonthOrder(nextOrder);
    try {
      if (currentUser && typeof window !== 'undefined') {
        window.localStorage.setItem(getMonthOrderStorageKey(currentUser.id), JSON.stringify(nextOrder));
      }
      await updateMonthOrderMutation({ monthOrder: nextOrder });
    } catch (error) {
      console.error('Failed to save month order', error);
      pendingMonthOrderRef.current = null;
      if (currentUser && typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(getMonthOrderStorageKey(currentUser.id));
        const parsed = raw ? JSON.parse(raw) : null;
        setMonthOrder(Array.isArray(parsed) && parsed.length === monthNames.length ? parsed : (currentUser?.monthOrder?.length === monthNames.length ? currentUser.monthOrder : monthNames));
      } else {
        setMonthOrder(currentUser?.monthOrder?.length === monthNames.length ? currentUser.monthOrder : monthNames);
      }
      window.alert('The month order could not be saved. Please try again.');
    }
  };
  const renameColumn = (columnKey) => {
    setAdminMenuColumn(null);
    const customColumn = customColumns.find((column) => column.key === columnKey);
    setRenameDialog({ isOpen: true, columnKey, value: customColumn?.label || columnLabels[columnKey] || '' });
  };

  const openRightsManager = (columnKey) => {
    setAdminMenuColumn(null);
    setRightsColumnKey(columnKey);
  };

  const deleteCustomColumn = async (columnKey) => {
    const column = customColumns.find((entry) => entry.key === columnKey);
    if (!column) {
      return;
    }
    setAdminMenuColumn(null);
    const shouldDelete = await requestConfirmation({ title: 'Delete column', message: 'Delete the whole column ' + column.label + '?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    try {
      await removeCustomColumnMutation({ columnKey });
    } catch (error) {
      console.error('Failed to delete custom column', error);
      window.alert('The column could not be deleted. Please try again.');
    }
  };

  const handleAddCustomColumn = async (submitEvent) => {
    submitEvent?.preventDefault?.();
    const trimmedName = newColumnName.trim();
    if (!trimmedName) {
      window.alert('Please enter a column name.');
      return;
    }
    try {
      await createCustomColumnMutation({ label: trimmedName, type: newColumnType });
      setShowAddColumnModal(false);
      setNewColumnName('');
      setNewColumnType('text');
    } catch (error) {
      console.error('Failed to create custom column', error);
      window.alert(error?.message || 'The column could not be added.');
    }
  };

  const openCustomOptionManager = (columnKey) => {
    setAdminMenuColumn(null);
    setCustomOptionManagerKey(columnKey);
    setNewCustomOptionName('');
    setNewCustomOptionColor('#d6d6d6');
    const initialDrafts = Object.fromEntries((customItemOptionsByColumn[columnKey] || []).map((option) => [option.optionKey, { name: option.name, color: option.color }]));
    setCustomOptionDrafts((current) => ({ ...current, [columnKey]: initialDrafts }));
  };

  const updateCustomOptionDraft = (columnKey, optionKey, key, value) => {
    setCustomOptionDrafts((current) => {
      const currentOption = (customItemOptionsByColumn[columnKey] || []).find((option) => option.optionKey === optionKey);
      return {
        ...current,
        [columnKey]: {
          ...(current[columnKey] || {}),
          [optionKey]: {
            ...((current[columnKey] || {})[optionKey] || { name: currentOption?.name || optionKey, color: currentOption?.color || '#d6d6d6' }),
            [key]: key === 'name' ? value.slice(0, 40) : value,
          },
        },
      };
    });
  };

  const addCustomOption = async () => {
    const columnKey = customOptionManagerKey;
    const name = newCustomOptionName.trim();
    if (!columnKey || !name) {
      return;
    }
    const options = customItemOptionsByColumn[columnKey] || [];
    try {
      await upsertLabelOptionMutation({
        columnKey,
        optionKey: name,
        name,
        color: newCustomOptionColor,
        order: options.length,
      });
      setNewCustomOptionName('');
      setNewCustomOptionColor('#d6d6d6');
    } catch (error) {
      console.error('Failed to add custom option', error);
      window.alert(error?.message || 'The option could not be added.');
    }
  };

  const saveCustomOption = async (columnKey, optionKey) => {
    const draft = ((customOptionDrafts[columnKey] || {})[optionKey]) || {};
    const currentOption = (customItemOptionsByColumn[columnKey] || []).find((option) => option.optionKey === optionKey);
    const nextName = (draft.name ?? currentOption?.name ?? '').trim();
    const nextColor = draft.color || currentOption?.color || '#d6d6d6';
    if (!nextName) {
      window.alert('Please enter a name before saving.');
      return;
    }
    try {
      await upsertLabelOptionMutation({
        columnKey,
        optionKey,
        name: nextName,
        color: nextColor,
        order: currentOption?.order || 0,
      });
      if (currentOption && currentOption.name !== nextName) {
        const column = customColumns.find((entry) => entry.key === columnKey);
        replaceEvents((current) => current.map((event) => {
          const currentValue = (event.customFields || {})[columnKey];
          if (column?.type === 'multiItem') {
            const mapped = Array.isArray(currentValue) ? currentValue.map((item) => item === currentOption.name ? nextName : item) : [];
            return { ...event, customFields: { ...(event.customFields || {}), [columnKey]: Array.from(new Set(mapped)) } };
          }
          return { ...event, customFields: { ...(event.customFields || {}), [columnKey]: currentValue === currentOption.name ? nextName : currentValue || '' } };
        }));
      }
    } catch (error) {
      console.error('Failed to save custom option', error);
      window.alert(error?.message || 'The option could not be saved.');
    }
  };

  const deleteCustomOption = async (columnKey, optionKey) => {
    const option = (customItemOptionsByColumn[columnKey] || []).find((entry) => entry.optionKey === optionKey);
    const label = option?.name || optionKey;
    const shouldDelete = await requestConfirmation({ title: 'Delete option', message: 'Delete option ' + label + '?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    removeLabelOption(columnKey, optionKey);
    const column = customColumns.find((entry) => entry.key === columnKey);
    replaceEvents((current) => current.map((event) => {
      const currentValue = (event.customFields || {})[columnKey];
      if (column?.type === 'multiItem') {
        return { ...event, customFields: { ...(event.customFields || {}), [columnKey]: Array.isArray(currentValue) ? currentValue.filter((item) => item !== label) : [] } };
      }
      return { ...event, customFields: { ...(event.customFields || {}), [columnKey]: currentValue === label ? '' : (currentValue || '') } };
    }));
  };

  const openCustomOptionSelector = (columnKey, eventId) => {
    setActiveRowId(eventId);
    setCustomOptionEditor({ columnKey, eventId });
  };

  const selectCustomSingleValue = (columnKey, eventId, value) => {
    updateEventCustomField(eventId, columnKey, value);
    setCustomOptionEditor({ columnKey: '', eventId: '' });
  };

  const toggleCustomMultiValue = (columnKey, eventId, value) => {
    updateEvent(eventId, (event) => {
      const currentValues = Array.isArray((event.customFields || {})[columnKey]) ? (event.customFields || {})[columnKey] : [];
      const hasValue = currentValues.includes(value);
      return {
        ...event,
        customFields: {
          ...(event.customFields || {}),
          [columnKey]: hasValue ? currentValues.filter((item) => item !== value) : [...currentValues, value],
        },
      };
    });
  };
  const getColumnPermission = (columnKey, subjectType, subjectValue) => (permissionsByColumn[columnKey] || []).find((permission) => subjectType === 'role' ? permission.subjectType === 'role' && permission.role === subjectValue : permission.subjectType === 'user' && permission.userId === subjectValue);

  const saveColumnPermission = async (columnKey, subjectType, subjectValue, patch) => {
    const existing = getColumnPermission(columnKey, subjectType, subjectValue);
    const next = {
      canView: existing?.canView ?? true,
      canEdit: existing?.canEdit ?? true,
      ...patch,
    };

    if (!next.canView) {
      next.canEdit = false;
    }
    if (patch.canEdit === true) {
      next.canView = true;
    }

    if (next.canView && next.canEdit) {
      if (existing) {
        await removeColumnPermissionMutation({ permissionId: existing.id });
      }
      return;
    }

    await upsertColumnPermissionMutation({
      columnKey,
      subjectType,
      role: subjectType === 'role' ? subjectValue : undefined,
      userId: subjectType === 'user' ? subjectValue : undefined,
      canView: next.canView,
      canEdit: next.canEdit,
    });
  };

  const clearColumnPermission = async (columnKey, subjectType, subjectValue) => {
    const existing = getColumnPermission(columnKey, subjectType, subjectValue);
    if (!existing) {
      return;
    }
    await removeColumnPermissionMutation({ permissionId: existing.id });
  };

  const toggleSelection = (setter, value) => {
    setter((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  };

  const clearFilters = () => {
    setSelectedBranches([]);
    setSelectedProducts([]);
    setSelectedStatuses([]);
    setSelectedPayments([]);
  };


  const openBranchManager = () => {
    setAdminMenuColumn(null);
    setBranchDrafts(Object.fromEntries(branchOptions.map((option) => [option.abbreviation, { abbreviation: option.abbreviation, fullName: option.fullName, color: option.color }])));
    setBranchManagerOpen(true);
  };

  const addBranchOption = () => {
    const fullName = newBranchFullName.trim();
    const abbreviation = newBranchAbbreviation.trim().toUpperCase();
    if (!fullName || !abbreviation || abbreviation.length > 5) {
      return;
    }
    if (branchOptions.some((option) => option.abbreviation.toLowerCase() === abbreviation.toLowerCase())) {
      window.alert('That abbreviation already exists.');
      return;
    }
    if (branchOptions.some((option) => option.fullName.toLowerCase() === fullName.toLowerCase())) {
      window.alert('That branch name already exists.');
      return;
    }
    const newOption = { abbreviation, fullName, color: newBranchColor };
    persistLabelOption('branch', abbreviation, fullName, abbreviation, newBranchColor, branchOptions.length);
    setBranchOptions((current) => [...current, newOption]);
    setBranchDrafts((current) => ({ ...current, [abbreviation]: newOption }));
    setNewBranchFullName('');
    setNewBranchAbbreviation('');
    setNewBranchColor('#b8d9ff');
  };

  const updateBranchDraft = (branchKey, key, value) => {
    setBranchDrafts((current) => ({
      ...current,
      [branchKey]: {
        ...(current[branchKey] || { abbreviation: branchKey, fullName: branchKey, color: '#b8d9ff' }),
        [key]: key === 'abbreviation' ? value.toUpperCase().slice(0, 5) : value,
      },
    }));
  };

  const saveBranchOption = (branchKey) => {
    const draft = branchDrafts[branchKey];
    const nextFullName = draft?.fullName?.trim();
    const nextAbbreviation = draft?.abbreviation?.trim().toUpperCase();
    const nextColor = draft?.color || '#b8d9ff';
    if (!nextFullName || !nextAbbreviation || nextAbbreviation.length > 5) {
      window.alert('Please enter a full name and an abbreviation of 5 characters or less.');
      return;
    }
    const duplicateAbbreviation = branchOptions.some((option) => option.abbreviation !== branchKey && option.abbreviation.toLowerCase() === nextAbbreviation.toLowerCase());
    if (duplicateAbbreviation) {
      window.alert('That abbreviation already exists.');
      return;
    }
    const duplicateBranchName = branchOptions.some((option) => option.abbreviation !== branchKey && option.fullName.toLowerCase() === nextFullName.toLowerCase());
    if (duplicateBranchName) {
      window.alert('That branch name already exists.');
      return;
    }

    persistLabelOption('branch', nextAbbreviation, nextFullName, nextAbbreviation, nextColor, branchOptions.findIndex((option) => option.abbreviation === branchKey));
      if (nextAbbreviation !== branchKey) {
        removeLabelOption('branch', branchKey);
      }
      setBranchOptions((current) => current.map((option) => (option.abbreviation === branchKey ? { abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor } : option)));
    if (nextAbbreviation !== branchKey) {
      replaceEvents((current) => current.map((event) => ({
        ...event,
        branch: Array.from(new Set(event.branch.map((item) => (item === branchKey ? nextAbbreviation : item)))),
      })));
      setSelectedBranches((current) => current.map((item) => (item === branchKey ? nextAbbreviation : item)));
      setEventForm((current) => ({
        ...current,
        branch: current.branch.map((item) => (item === branchKey ? nextAbbreviation : item)),
      }));
      setBranchDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[branchKey];
        nextDrafts[nextAbbreviation] = { abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor };
        return nextDrafts;
      });
      return;
    }
    setBranchDrafts((current) => ({ ...current, [branchKey]: { abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor } }));
  };

  const deleteBranchOption = async (branchKey) => {
    const label = branchFullNames[branchKey] || branchKey;
    const shouldDelete = await requestConfirmation({ title: 'Delete branch', message: `Delete branch ${label}?`, confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    removeLabelOption('branch', branchKey);
      setBranchOptions((current) => current.filter((option) => option.abbreviation !== branchKey));
    setBranchDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[branchKey];
      return nextDrafts;
    });
    replaceEvents((current) => current.map((event) => ({
      ...event,
      branch: event.branch.filter((item) => item !== branchKey),
    })));
    setSelectedBranches((current) => current.filter((item) => item !== branchKey));
    setEventForm((current) => ({
      ...current,
      branch: current.branch.filter((item) => item !== branchKey),
    }));
  };

  const openBranchSelector = (eventId) => {
    setActiveRowId(eventId);
    setBranchEditorEventId(eventId);
  };

  const toggleBranchOnEvent = (eventId, branchName) => {
    updateEvent(eventId, (event) => {
      const hasBranch = event.branch.includes(branchName);
      return {
        ...event,
        branch: hasBranch ? event.branch.filter((item) => item !== branchName) : [...event.branch, branchName],
      };
    });
  };

  const openProductManager = () => {
    setAdminMenuColumn(null);
    setProductDrafts(Object.fromEntries(productOptions.map((option) => {
      const productKey = getProductIdentity(option);
      return [productKey, { abbreviation: getProductStoredValue(option), fullName: sanitizeProductLabel(option.fullName), color: option.color }];
    })));
    setProductManagerOpen(true);
  };

  const addProductOption = () => {
    const fullName = newProductFullName.trim();
    const abbreviation = newProductAbbreviation.trim().toUpperCase();
    if (!fullName || !abbreviation || abbreviation.length > 5) {
      return;
    }
    if (productOptions.some((option) => option.abbreviation === abbreviation)) {
      window.alert('A product with that abbreviation already exists. Please change it slightly.');
      return;
    }
    if (productOptions.some((option) => option.fullName.toLowerCase() === fullName.toLowerCase())) {
      window.alert('That product name already exists.');
      return;
    }
    const newOption = { abbreviation, fullName, color: newProductColor };
    persistLabelOption('products', abbreviation, fullName, abbreviation, newProductColor, productOptions.length);
    setProductOptions((current) => [...current, newOption]);
    setProductDrafts((current) => ({ ...current, [abbreviation]: newOption }));
    setNewProductFullName('');
    setNewProductAbbreviation('');
    setNewProductColor('#d9edf8');
  };

  const updateProductDraft = (productKey, key, value) => {
    setProductDrafts((current) => ({
      ...current,
      [productKey]: {
        ...(current[productKey] || { abbreviation: '', fullName: '', color: '#d9edf8' }),
        [key]: key === 'abbreviation' ? value.toUpperCase().slice(0, 5) : value,
      },
    }));
  };

  const saveProductOption = (productKey) => {
    const draft = productDrafts[productKey];
    const nextFullName = draft?.fullName?.trim();
    const nextColor = draft?.color || '#d9edf8';
    const nextAbbreviation = draft?.abbreviation?.trim().toUpperCase();
    if (!nextFullName || !nextAbbreviation || nextAbbreviation.length > 5) {
      window.alert('Please enter a full name and an abbreviation of 5 characters or less.');
      return;
    }
    const duplicateAbbreviation = productOptions.some((option) => (option.optionKey || option.abbreviation) !== productKey && option.abbreviation === nextAbbreviation);
    if (duplicateAbbreviation) {
      window.alert('Another product already uses that abbreviation.');
      return;
    }
    const duplicateProductName = productOptions.some((option) => (option.optionKey || option.abbreviation) !== productKey && option.fullName.toLowerCase() === nextFullName.toLowerCase());
    if (duplicateProductName) {
      window.alert('That product name already exists.');
      return;
    }
    persistLabelOption('products', productKey, nextFullName, nextAbbreviation, nextColor, productOptions.findIndex((option) => (option.optionKey || option.abbreviation) === productKey));
      setProductOptions((current) => current.map((option) => ((option.optionKey || option.abbreviation) === productKey ? { ...option, abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor } : option)));
    if (nextAbbreviation !== productKey) {
      replaceEvents((current) => current.map((event) => ({
        ...event,
        products: Array.from(new Set(event.products.map((item) => (item === (productOptions.find((option) => (option.optionKey || option.abbreviation) === productKey)?.abbreviation || productKey) ? nextAbbreviation : item)))),
      })));
      setSelectedProducts((current) => current.map((item) => (item === (productOptions.find((option) => (option.optionKey || option.abbreviation) === productKey)?.abbreviation || productKey) ? nextAbbreviation : item)));
      setEventForm((current) => ({
        ...current,
        products: current.products.map((item) => (item === (productOptions.find((option) => (option.optionKey || option.abbreviation) === productKey)?.abbreviation || productKey) ? nextAbbreviation : item)),
      }));
      setProductDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[productKey];
        nextDrafts[nextAbbreviation] = { abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor };
        return nextDrafts;
      });
      return;
    }
    setProductDrafts((current) => ({ ...current, [productKey]: { abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor } }));
  };

  const deleteProductOption = async (productKey) => {
    const label = productFullNames[productKey] || productKey;
    const shouldDelete = await requestConfirmation({ title: 'Delete product', message: `Delete product ${label}?`, confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    removeLabelOption('products', productKey);
      setProductOptions((current) => current.filter((option) => getProductIdentity(option) !== productKey));
    setProductDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[productKey];
      return nextDrafts;
    });
    replaceEvents((current) => current.map((event) => ({
      ...event,
      products: event.products.filter((item) => item !== productKey),
    })));
    setSelectedProducts((current) => current.filter((item) => item !== productKey));
    setEventForm((current) => ({
      ...current,
      products: current.products.filter((item) => item !== productKey),
    }));
  };

  const openProductSelector = (eventId) => {
    setActiveRowId(eventId);
    setProductEditorEventId(eventId);
  };

  const toggleProductOnEvent = (eventId, productKey) => {
    updateEvent(eventId, (event) => {
      const hasProduct = event.products.includes(productKey);
      return {
        ...event,
        products: hasProduct ? event.products.filter((item) => item !== productKey) : [...event.products, productKey],
      };
    });
  };

  const openStatusManager = () => {
    setAdminMenuColumn(null);
    setStatusDrafts(Object.fromEntries(statusOptions.map((option) => [option.name, { name: option.name, color: option.color }])));
    setStatusManagerOpen(true);
  };

  const addStatusOption = () => {
    const name = newStatusName.trim();
    if (!name || name.length > 15) {
      return;
    }
    if (statusOptions.some((option) => option.name.toLowerCase() === name.toLowerCase())) {
      window.alert('That status already exists.');
      return;
    }
    const newOption = { name, color: newStatusColor };
    persistLabelOption('status', name, name, '', newStatusColor, statusOptions.length);
    setStatusOptions((current) => [...current, newOption]);
    setStatusDrafts((current) => ({ ...current, [name]: newOption }));
    setNewStatusName('');
    setNewStatusColor('#23b26d');
  };

  const updateStatusDraft = (statusKey, key, value) => {
    setStatusDrafts((current) => ({
      ...current,
      [statusKey]: {
        ...(current[statusKey] || { name: statusKey, color: '#23b26d' }),
        [key]: key === 'name' ? value.slice(0, 15) : value,
      },
    }));
  };

  const saveStatusOption = (statusKey) => {
    const draft = statusDrafts[statusKey];
    const nextName = draft?.name?.trim();
    const nextColor = draft?.color || '#23b26d';
    if (!nextName || nextName.length > 15) {
      window.alert('Please enter a status name of 15 characters or less.');
      return;
    }
    const duplicateName = statusOptions.some((option) => option.name !== statusKey && option.name.toLowerCase() === nextName.toLowerCase());
    if (duplicateName) {
      window.alert('That status already exists.');
      return;
    }
    persistLabelOption('status', nextName, nextName, '', nextColor, statusOptions.findIndex((option) => option.name === statusKey));
      if (nextName !== statusKey) {
        removeLabelOption('status', statusKey);
      }
      setStatusOptions((current) => current.map((option) => (option.name === statusKey ? { name: nextName, color: nextColor } : option)));
    if (nextName !== statusKey) {
      replaceEvents((current) => current.map((event) => ({ ...event, status: event.status === statusKey ? nextName : event.status })));
      setSelectedStatuses((current) => current.map((item) => (item === statusKey ? nextName : item)));
      setEventForm((current) => ({ ...current, status: current.status === statusKey ? nextName : current.status }));
      setStatusDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[statusKey];
        nextDrafts[nextName] = { name: nextName, color: nextColor };
        return nextDrafts;
      });
      return;
    }
    setStatusDrafts((current) => ({ ...current, [statusKey]: { name: nextName, color: nextColor } }));
  };

  const deleteStatusOption = async (statusKey) => {
    const shouldDelete = await requestConfirmation({ title: 'Delete status', message: 'Delete status ' + statusKey + '?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    removeLabelOption('status', statusKey);
      setStatusOptions((current) => current.filter((option) => option.name !== statusKey));
    setStatusDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[statusKey];
      return nextDrafts;
    });
    replaceEvents((current) => current.map((event) => ({ ...event, status: event.status === statusKey ? '' : event.status })));
    setSelectedStatuses((current) => current.filter((item) => item !== statusKey));
    setEventForm((current) => ({ ...current, status: current.status === statusKey ? '' : current.status }));
  };

  const openStatusSelector = (eventId) => {
    setActiveRowId(eventId);
    setStatusEditorEventId(eventId);
  };

  const selectStatusOnEvent = (eventId, statusName) => {
    updateEvent(eventId, (event) => ({ ...event, status: statusName }));
    setStatusEditorEventId(null);
  };

  const openManagedSingleManager = (columnKey) => {
    setAdminMenuColumn(null);
    const options = managedSingleOptions[columnKey] || [];
    setManagedSingleDrafts((current) => ({
      ...current,
      [columnKey]: Object.fromEntries(options.map((option) => [option.name, { name: option.name, color: option.color }])),
    }));
    setNewManagedOptionName('');
    setNewManagedOptionColor(columnKey === 'paymentStatus' ? '#2b61d1' : '#d93c56');
    setManagedSingleManagerKey(columnKey);
  };

  const addManagedSingleOption = () => {
    const columnKey = managedSingleManagerKey;
    const name = newManagedOptionName.trim();
    if (!columnKey || !name || name.length > 15) {
      return;
    }
    const options = managedSingleOptions[columnKey] || [];
    if (options.some((option) => option.name.toLowerCase() === name.toLowerCase())) {
      window.alert('That option already exists.');
      return;
    }
    const newOption = { name, color: newManagedOptionColor };
    persistLabelOption(columnKey, name, name, '', newManagedOptionColor, options.length);
    setManagedSingleOptions((current) => ({ ...current, [columnKey]: [...(current[columnKey] || []), newOption] }));
    setManagedSingleDrafts((current) => ({ ...current, [columnKey]: { ...(current[columnKey] || {}), [name]: newOption } }));
    setNewManagedOptionName('');
  };

  const updateManagedSingleDraft = (columnKey, optionKey, key, value) => {
    setManagedSingleDrafts((current) => ({
      ...current,
      [columnKey]: {
        ...(current[columnKey] || {}),
        [optionKey]: {
          ...((current[columnKey] || {})[optionKey] || { name: optionKey, color: '#d6d6d6' }),
          [key]: key === 'name' ? value.slice(0, 15) : value,
        },
      },
    }));
  };

  const saveManagedSingleOption = (columnKey, optionKey) => {
    const draft = (managedSingleDrafts[columnKey] || {})[optionKey];
    const nextName = draft?.name?.trim();
    const nextColor = draft?.color || '#d6d6d6';
    if (!nextName || nextName.length > 15) {
      window.alert('Please enter a name of 15 characters or less.');
      return;
    }
    const options = managedSingleOptions[columnKey] || [];
    if (options.some((option) => option.name !== optionKey && option.name.toLowerCase() === nextName.toLowerCase())) {
      window.alert('That option already exists.');
      return;
    }
    persistLabelOption(columnKey, nextName, nextName, '', nextColor, options.findIndex((option) => option.name === optionKey));
      if (nextName !== optionKey) {
        removeLabelOption(columnKey, optionKey);
      }
      setManagedSingleOptions((current) => ({ ...current, [columnKey]: (current[columnKey] || []).map((option) => (option.name === optionKey ? { name: nextName, color: nextColor } : option)) }));
    if (nextName !== optionKey) {
      replaceEvents((current) => current.map((event) => ({ ...event, [columnKey]: event[columnKey] === optionKey ? nextName : event[columnKey] })));
      if (columnKey === 'paymentStatus') {
        setSelectedPayments((current) => current.map((item) => (item === optionKey ? nextName : item)));
      }
      setEventForm((current) => ({ ...current, [columnKey]: current[columnKey] === optionKey ? nextName : current[columnKey] }));
      setManagedSingleDrafts((current) => {
        const nextDrafts = { ...(current[columnKey] || {}) };
        delete nextDrafts[optionKey];
        nextDrafts[nextName] = { name: nextName, color: nextColor };
        return { ...current, [columnKey]: nextDrafts };
      });
      return;
    }
    setManagedSingleDrafts((current) => ({ ...current, [columnKey]: { ...(current[columnKey] || {}), [optionKey]: { name: nextName, color: nextColor } } }));
  };

  const deleteManagedSingleOption = async (columnKey, optionKey) => {
    const shouldDelete = await requestConfirmation({ title: 'Delete option', message: 'Delete option ' + optionKey + '?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    removeLabelOption(columnKey, optionKey);
      setManagedSingleOptions((current) => ({ ...current, [columnKey]: (current[columnKey] || []).filter((option) => option.name !== optionKey) }));
    setManagedSingleDrafts((current) => {
      const nextColumnDrafts = { ...(current[columnKey] || {}) };
      delete nextColumnDrafts[optionKey];
      return { ...current, [columnKey]: nextColumnDrafts };
    });
    replaceEvents((current) => current.map((event) => ({ ...event, [columnKey]: event[columnKey] === optionKey ? '' : event[columnKey] })));
    if (columnKey === 'paymentStatus') {
      setSelectedPayments((current) => current.filter((item) => item !== optionKey));
    }
    setEventForm((current) => ({ ...current, [columnKey]: current[columnKey] === optionKey ? '' : current[columnKey] }));
  };

  const openManagedSingleSelector = (columnKey, eventId) => {
    setActiveRowId(eventId);
    setManagedSingleEditor({ columnKey, eventId });
  };

  const selectManagedSingleValue = (columnKey, eventId, value) => {
    updateEvent(eventId, (event) => ({ ...event, [columnKey]: value }));
    setManagedSingleEditor({ columnKey: '', eventId: '' });
  };

  const openAttendantManager = () => {
    setAdminMenuColumn(null);
    setAttendantDrafts(Object.fromEntries(attendantOptions.map((option) => [option.fullName, { fullName: option.fullName }])));
    setAttendantManagerOpen(true);
  };

  const addAttendantOption = () => {
    const fullName = newAttendantName.trim();
    if (!fullName || fullName.length > 100) {
      return;
    }
    if (attendantOptions.some((option) => option.fullName.toLowerCase() === fullName.toLowerCase())) {
      window.alert('That attendant already exists.');
      return;
    }
    const newOption = { fullName };
    persistLabelOption('attendants', fullName, fullName, '', '#dfe7f6', attendantOptions.length);
    setAttendantOptions((current) => [...current, newOption]);
    setAttendantDrafts((current) => ({ ...current, [fullName]: newOption }));
    setNewAttendantName('');
  };

  const updateAttendantDraft = (attendantKey, value) => {
    setAttendantDrafts((current) => ({
      ...current,
      [attendantKey]: {
        ...((current[attendantKey]) || { fullName: attendantKey }),
        fullName: value.slice(0, 100),
      },
    }));
  };

  const saveAttendantOption = (attendantKey) => {
    const draft = attendantDrafts[attendantKey];
    const nextName = draft?.fullName?.trim();
    if (!nextName || nextName.length > 100) {
      window.alert('Please enter a name of 100 characters or less.');
      return;
    }
    if (attendantOptions.some((option) => option.fullName !== attendantKey && option.fullName.toLowerCase() === nextName.toLowerCase())) {
      window.alert('That attendant already exists.');
      return;
    }
    persistLabelOption('attendants', nextName, nextName, '', '#dfe7f6', attendantOptions.findIndex((option) => option.fullName === attendantKey));
      if (nextName !== attendantKey) {
        removeLabelOption('attendants', attendantKey);
      }
      setAttendantOptions((current) => current.map((option) => (option.fullName === attendantKey ? { fullName: nextName } : option)));
    if (nextName !== attendantKey) {
      replaceEvents((current) => current.map((event) => ({ ...event, attendants: (event.attendants || []).map((item) => item === attendantKey ? nextName : item) })));
      setEventForm((current) => ({ ...current, attendants: (current.attendants || []).map((item) => item === attendantKey ? nextName : item) }));
      setAttendantDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[attendantKey];
        nextDrafts[nextName] = { fullName: nextName };
        return nextDrafts;
      });
      return;
    }
    setAttendantDrafts((current) => ({ ...current, [attendantKey]: { fullName: nextName } }));
  };

  const deleteAttendantOption = async (attendantKey) => {
    const shouldDelete = await requestConfirmation({ title: 'Delete attendant', message: 'Delete attendant ' + attendantKey + '?', confirmLabel: 'Delete', tone: 'danger' });
    if (!shouldDelete) {
      return;
    }
    removeLabelOption('attendants', attendantKey);
      setAttendantOptions((current) => current.filter((option) => option.fullName !== attendantKey));
    setAttendantDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[attendantKey];
      return nextDrafts;
    });
    replaceEvents((current) => current.map((event) => ({ ...event, attendants: (event.attendants || []).filter((item) => item !== attendantKey) })));
    setEventForm((current) => ({ ...current, attendants: (current.attendants || []).filter((item) => item !== attendantKey) }));
  };

  const openAttendantSelector = (eventId) => {
    setActiveRowId(eventId);
    setAttendantEditorEventId(eventId);
  };

  const toggleAttendantOnEvent = (eventId, attendantName) => {
    updateEvent(eventId, (event) => {
      const currentAttendants = event.attendants || [];
      const hasAttendant = currentAttendants.includes(attendantName);
      return {
        ...event,
        attendants: hasAttendant ? currentAttendants.filter((item) => item !== attendantName) : [...currentAttendants, attendantName],
      };
    });
  };

  const isUserSyncing = Boolean(clerkUser && !currentUser && userSyncKeyRef.current === clerkUser.id);

  if (currentUser === undefined || isUserSyncing || (canAccessDashboard && workspaceRecords === undefined)) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">SelfieBox Events</div>
          <h1>Loading your account</h1>
          <p>Please wait while Clerk connects your session.</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">SelfieBox Events</div>
          <h1>Finalising your account</h1>
          <p>Please wait while we create your user profile.</p>
        </div>
      </div>
    );
  }

  if (!currentUser.isApproved || !currentUser.isActive) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">SelfieBox Events</div>
          <h1>Waiting for approval</h1>
          <p>Your account has been created, but an administrator still needs to approve and activate it before you can access the dashboard.</p>
          <div className="auth-form">
            <button className="ghost-button" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar compact">
        <div>
          <div className="topbar-kicker">Events Dashboard</div>
          <h1>SelfieBox Events {selectedWorkspaceYear}</h1>
        </div>
        <div className="topbar-actions compact-actions">
          <div className="workspace-select-wrap">
            <span className="workspace-prefix">Workspace for</span>
            <select value={selectedWorkspaceYear} onChange={(event) => setSelectedWorkspaceYear(Number(event.target.value))}>{workspaceYears.map((year) => <option key={year} value={year}>{year}</option>)}</select>
            <div className="workspace-link-stack">
              <button className="workspace-text-button" type="button" onClick={() => setShowWorkspaceModal(true)}>Add Year</button>
              <button className="workspace-text-button" type="button" onClick={exportWorkspaceToExcel}>Export to Excel</button>
            </div>
          </div>
          {currentUser.role === 'admin' ? <button className="ghost-button manage-users-button" type="button" onClick={() => setShowUsersModal(true)}>Manage Users</button> : null}
          <button className="profile-pill" type="button" onClick={() => setShowProfileModal(true)}><span className="profile-pill-media">{currentUser.profilePic ? <img className="profile-pill-image" src={currentUser.profilePic} alt={`${currentUser.firstName} ${currentUser.surname}`} /> : initials}</span><strong>{currentUser.firstName} {currentUser.surname}</strong></button>
        </div>
      </header>

      <section className="board-shell">
        <div className="board-toolbar compact-toolbar">
          <div className="filters-grid compact-filters single-row-tools">
            <div className="search-input-wrap">
              <input className="text-input search-wide search-input" aria-label="Search events" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name" />
              {search ? <button className="search-clear-button" type="button" aria-label="Clear search" onClick={() => setSearch('')}>x</button> : null}
            </div>
            <button className="ghost-button filter-button" type="button" onClick={() => setFiltersOpen(true)}>Filter</button>
            <button className="ghost-button filter-button" type="button" onClick={clearFilters}>Clear</button>
          </div>
          <button className="workspace-text-button board-activities-link" type="button" onClick={() => setActivitiesOpen(true)}>Activities</button>
        </div>
        <div className="board-surface" ref={boardSurfaceRef} style={{ '--board-columns': boardColumnTemplate, '--board-width': `${boardWidth}px` }}>
          <div className="board-row board-header" style={{ gridTemplateColumns: boardColumnTemplate, width: `${boardWidth}px` }} onClick={() => setAdminMenuColumn(null)}>
            {visibleColumns.map((column) => (
              <div className={`cell cell-${column.key}`} key={column.key} style={column.isCustom && column.type === 'singleItem' ? { width: `${getRenderedColumnWidth(column)}px`, minWidth: `${getRenderedColumnWidth(column)}px` } : undefined} onContextMenu={(event) => {
                if (currentUser.role !== 'admin') return;
                event.preventDefault();
                setAdminMenuColumn(column.key);
                setAdminMenuPosition({ top: event.clientY + 4, left: event.clientX + 4 });
              }}>
                <span>{displayColumnLabel(column)}</span>
                {adminMenuColumn === column.key ? <div className="admin-menu" style={{ top: adminMenuPosition.top, left: adminMenuPosition.left }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => renameColumn(column.key)}>Rename header</button><button type="button" onClick={() => openRightsManager(column.key)}>Manage rights</button>{column.key === 'branch' ? <button type="button" onClick={openBranchManager}>Add/Edit item</button> : null}{column.key === 'products' ? <button type="button" onClick={openProductManager}>Add/Edit item</button> : null}{column.key === 'status' ? <button type="button" onClick={openStatusManager}>Add/Edit item</button> : null}{['paymentStatus', 'vinyl', 'gsAi', 'imagesSent', 'snappic'].includes(column.key) ? <button type="button" onClick={() => openManagedSingleManager(column.key)}>Add/Edit item</button> : null}{column.key === 'attendants' ? <button type="button" onClick={openAttendantManager}>Add/Edit item</button> : null}{customColumns.some((customColumn) => customColumn.key === column.key && ['singleItem', 'multiItem'].includes(customColumn.type)) ? <button type="button" onClick={() => openCustomOptionManager(column.key)}>Add/Edit item</button> : null}{column.isCustom ? <button type="button" onClick={() => deleteCustomColumn(column.key)}>Delete column</button> : null}</div> : null}
              </div>
            ))}
            {currentUser.role === 'admin' ? <button className="cell cell-actions add-column-trigger" type="button" onClick={() => setShowAddColumnModal(true)}>+</button> : <div className="cell cell-actions" />}
          </div>

          {orderedMonths.map((month) => {
            const monthItems = eventsByMonth[month] || [];
            const totals = monthItems.reduce((accumulator, event) => ({ exVat: accumulator.exVat + Number(event.exVat || 0), packageOnly: accumulator.packageOnly + Number(event.packageOnly || 0) }), { exVat: 0, packageOnly: 0 });
            const upcomingCount = monthItems.filter((event) => event.status === 'In Progress').length;
            const completedCount = monthItems.filter((event) => event.status === 'Event Completed').length;
            return (
              <section className={`month-section ${monthAccentClass[month]}`} key={month} style={{ minWidth: `${boardWidth}px` }}>
                <button className="month-header" type="button" style={{ minWidth: `${boardWidth}px` }} onClick={() => toggleMonth(month)}>
                  <div className="month-header-main"><strong>{month} {selectedWorkspaceYear}</strong><span>{monthItems.length} events</span><span>{upcomingCount} Upcoming Events</span><span>{completedCount} Completed Events</span></div>
                  <div className="month-header-actions"><div className="month-order-controls"><button className="month-order-button" type="button" onClick={(event) => { event.stopPropagation(); void moveMonth(month, -1); }} disabled={orderedMonths.indexOf(month) === 0} title="Move month up">^</button><button className="month-order-button" type="button" onClick={(event) => { event.stopPropagation(); void moveMonth(month, 1); }} disabled={orderedMonths.indexOf(month) === orderedMonths.length - 1} title="Move month down">v</button></div><span className="month-toggle">{collapsedMonths[month] ? '+' : '-'}</span></div>
                </button>
                {!collapsedMonths[month] ? (
                  <>
                    {monthItems.length > 0 ? monthItems.map((event) => <div key={event.id} ref={(node) => setEventRowRef(event.id, node)} className={["board-row", "board-entry", getEventDayShadeClass(event), highlightedRowId === event.id ? "is-active" : ""].join(" ").trim()} style={{ gridTemplateColumns: boardColumnTemplate, width: `${boardWidth}px` }}>{visibleColumns.map((column) => <div className={`cell cell-${column.key}`} key={column.key} style={column.isCustom && column.type === 'singleItem' ? { width: `${getRenderedColumnWidth(column)}px`, minWidth: `${getRenderedColumnWidth(column)}px` } : undefined}>{renderCell({ columnKey: column.key, event, openDrawer, updateEventField, updateEventLocationText, applyEventLocation, updateEventCustomField, dateEditor, setDateEditor, openDateEditor, closeDateEditor, applyEventDate, openBranchSelector, openProductSelector, openStatusSelector, openManagedSingleSelector, openAttendantSelector, openCustomOptionSelector, branchStyles, branchFullNames, productStyles, productFullNames, statusStyles, managedSingleStyles, customItemStyles, customColumns, customSingleTagWidths, setActiveRowId, openLocationPreview, canEdit: effectiveColumnRights[column.key]?.canEdit ?? true })}</div>)}<div className="cell cell-actions"><button className="row-copy" type="button" title="Duplicate" onClick={() => duplicateEvent(event.id)} disabled={!canManageRows}>D</button><button className="row-delete" type="button" title="Delete" onClick={() => deleteEvent(event.id)} disabled={!canManageRows}>X</button></div></div>) : <div className="empty-month">No events in this month yet.</div>}
                    <button className="add-inline-row" type="button" onClick={() => addBlankEvent(month)} disabled={!canManageRows}>+ Add Event</button>
                    <div className="board-row totals-row" style={{ gridTemplateColumns: boardColumnTemplate, width: `${boardWidth}px` }}>{visibleColumns.map((column) => <div className={`cell cell-${column.key}`} key={column.key}>{column.key === 'name' ? <strong>Totals</strong> : column.key === 'exVat' ? currencyFormatter.format(totals.exVat) : column.key === 'packageOnly' ? currencyFormatter.format(totals.packageOnly) : ''}</div>)}<div className="cell cell-actions" /></div>
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>

      <footer className="app-footer"><span>Total events completed for {selectedWorkspaceYear} is {selectedYearCompletedCount}</span><span>Software developed by SelfieBox - All rights reserved</span></footer>

      <div className={`drawer-scrim ${drawerOpen || activitiesOpen ? 'is-visible' : ''}`} onClick={() => { closeDrawer(); setActivitiesOpen(false); }} />
      <aside className={`event-drawer board-activities-drawer ${activitiesOpen ? 'is-open' : ''}`}>
        <div className="drawer-header"><div><div className="topbar-kicker">Activities</div><h3>Board activities</h3></div><button className="drawer-close" type="button" onClick={() => setActivitiesOpen(false)}>x</button></div>
        <section className="drawer-card"><h4>{selectedWorkspaceYear} workspace</h4><div className="activity-list board-activity-list">{boardActivities.length ? boardActivities.map((entry) => <ActivityEntry entry={{ ...entry, text: entry.text }} eventName={entry.eventName} title={`${entry.eventName}: ${entry.text}`} />) : <div className="empty-month">No board activities yet.</div>}</div></section>
      </aside>
      <aside className={`event-drawer ${drawerOpen ? 'is-open' : ''}`}>
        {selectedEvent ? <><div className="drawer-header"><div><div className="topbar-kicker">Event drawer</div><h3>{selectedEvent.name || 'New event'}</h3><p className="drawer-meta">{[formatDateDisplay(selectedEvent.date), selectedEvent.hours, (selectedEvent.branch || []).map((item) => branchFullNames[item] || item).join(', ')].filter(Boolean).join('   ')}</p>{selectedEvent.location ? <div className="drawer-location-row"><span className="drawer-location-text" title={selectedEvent.location}>{selectedEvent.location}</span>{typeof selectedEvent.locationLat === 'number' && typeof selectedEvent.locationLng === 'number' ? <button className="location-pin-button drawer-location-pin" type="button" title="View map" onClick={() => openLocationPreview(selectedEvent)}>{renderPinIcon()}</button> : null}</div> : null}</div><button className="drawer-close" type="button" onClick={closeDrawer}>x</button></div><div className="drawer-tabs">{[{ id: 'updates', label: 'Updates' }, { id: 'files', label: 'Files' }, { id: 'activity', label: 'Activity Log' }].map((tab) => <button className={drawerTab === tab.id ? 'is-active' : ''} key={tab.id} type="button" onClick={() => setDrawerTab(tab.id)}>{tab.label}</button>)}</div>{drawerTab === 'updates' ? <div className="drawer-section-stack"><section className="drawer-card"><h4>Updates / Notes</h4><textarea rows={4} value={draftUpdate} onChange={(event) => setDraftUpdate(event.target.value)} onBlur={saveQuickUpdate} placeholder="Click and type. Updates save when you leave the field." /></section><section className="drawer-card"><h4>Update stream</h4><div className="activity-list">{selectedEventUpdates.map((entry) => <ActivityEntry entry={entry} title={entry.text} />)}</div></section></div> : null}{drawerTab === 'files' ? <div className="drawer-section-stack"><section className="drawer-card"><h4>Accepted uploads</h4><p>PDF, JPG, PNG, JPEG</p><button className="primary-button" type="button" onClick={openEventFilePicker}>Upload file</button><input ref={eventFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleEventFileSelection} /></section><section className="drawer-card"><h4>Files gallery</h4><div className="file-list">{selectedEventFiles.map((file) => <article className="file-card" key={file.id}><div className="file-card-main"><span>{file.type}</span><strong className="file-name" title={file.name}>{file.url ? <button className="file-name-button" type="button" title={file.name} onClick={() => openEventFilePreview(file)}>{file.name}</button> : file.name}</strong><p>{file.size || file.uploadedAt}</p></div><button className="file-delete" type="button" onClick={() => deleteEventFile(file.id)}>Delete</button></article>)}</div></section></div> : null}{drawerTab === 'activity' ? <section className="drawer-card"><h4>All activity</h4><div className="activity-list">{selectedEventActivity.map((entry) => <ActivityEntry entry={entry} title={entry.text} />)}</div></section> : null}</> : null}
      </aside>

      {previewFile ? <div className="modal-scrim" onClick={closeEventFilePreview}><div className="modal-panel file-preview-panel" role="dialog" aria-modal="true" aria-label={previewFile.name} onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3 title={previewFile.name}>{previewFile.name}</h3></div><div className="file-preview-body">{isPreviewImage(previewFile) ? <img className="file-preview-image" src={previewFile.url} alt={previewFile.name} /> : null}{!isPreviewImage(previewFile) && isPreviewPdf(previewFile) ? <iframe className="file-preview-frame" src={previewFile.url} title={previewFile.name} /> : null}{!isPreviewImage(previewFile) && !isPreviewPdf(previewFile) ? <div className="empty-month">This file cannot be previewed here yet.</div> : null}</div><div className="modal-actions"><a className="primary-button file-preview-link" href={previewFile.url} target="_blank" rel="noreferrer">Open in new tab</a></div></div></div> : null}

      {locationPreview ? <div className="modal-scrim" onClick={closeLocationPreview}><div className="modal-panel map-preview-panel" role="dialog" aria-modal="true" aria-label={locationPreview.title} onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><h3>{locationPreview.title}</h3><p className="map-preview-address" title={locationPreview.address}>{locationPreview.address}</p></div></div><LocationMapPreview location={locationPreview} /><div className="modal-actions"><a className="ghost-button file-preview-link" href={buildGoogleMapsExternalUrl(locationPreview)} target="_blank" rel="noreferrer">Open in Google Maps</a></div></div></div> : null}

      {renameDialog.isOpen ? <ModalShell title="Rename header" onClose={closeRenameDialog}><div className="simple-stack"><label className="full-span"><span>Header name</span><input className="text-input" value={renameDialog.value} onChange={(event) => setRenameDialog((current) => ({ ...current, value: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveRenamedColumn(); } }} autoFocus /></label><div className="modal-actions"><button className="ghost-button" type="button" onClick={closeRenameDialog}>Cancel</button><button className="primary-button" type="button" onClick={saveRenamedColumn}>Save</button></div></div></ModalShell> : null}

      {rightsColumnKey ? <ModalShell title={`Manage rights for ${displayColumnLabel(allColumns.find((column) => column.key === rightsColumnKey) || { key: rightsColumnKey, label: rightsColumnKey, isCustom: false })}`} onClose={() => setRightsColumnKey('')}><div className="rights-modal"><section className="rights-section"><h4>Roles</h4>{['manager', 'user'].map((role) => { const permission = getColumnPermission(rightsColumnKey, 'role', role); const canView = permission?.canView ?? true; const canEdit = permission?.canEdit ?? true; return <div className="rights-row" key={role}><div className="rights-subject"><strong>{formatRole(role)}</strong><small>{permission ? 'Override active' : 'Inherited'}</small></div><label><input type="checkbox" checked={canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'role', role, { canView: event.target.checked })} />View</label><label><input type="checkbox" checked={canEdit} disabled={!canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'role', role, { canEdit: event.target.checked })} />Edit</label><button className="ghost-button compact-manager-button" type="button" onClick={() => void clearColumnPermission(rightsColumnKey, 'role', role)} disabled={!permission}>Clear</button></div>; })}</section><section className="rights-section"><h4>Users</h4>{users.filter((user) => user.role !== 'admin').map((user) => { const permission = getColumnPermission(rightsColumnKey, 'user', user.id); const canView = permission?.canView ?? true; const canEdit = permission?.canEdit ?? true; return <div className="rights-row" key={user.id}><div className="rights-subject"><strong>{user.firstName} {user.surname}</strong><small>{permission ? 'Override active' : 'Inherited'} ? {formatRole(user.role)}</small></div><label><input type="checkbox" checked={canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'user', user.id, { canView: event.target.checked })} />View</label><label><input type="checkbox" checked={canEdit} disabled={!canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'user', user.id, { canEdit: event.target.checked })} />Edit</label><button className="ghost-button compact-manager-button" type="button" onClick={() => void clearColumnPermission(rightsColumnKey, 'user', user.id)} disabled={!permission}>Clear</button></div>; })}</section></div></ModalShell> : null}
      {filtersOpen ? <ModalShell title="Filters" onClose={() => setFiltersOpen(false)} hideCloseButton><div className="filter-popup"><FilterGroup title="Branches" options={branchAbbreviations} selected={selectedBranches} onToggle={(value) => toggleSelection(setSelectedBranches, value)} /><FilterGroup title="Products" options={productAbbreviations} selected={selectedProducts} onToggle={(value) => toggleSelection(setSelectedProducts, value)} /><FilterGroup title="Statuses" options={statusNames} selected={selectedStatuses} onToggle={(value) => toggleSelection(setSelectedStatuses, value)} /><FilterGroup title="Payment" options={getManagedOptionNames(managedSingleOptions, 'paymentStatus')} selected={selectedPayments} onToggle={(value) => toggleSelection(setSelectedPayments, value)} /><div className="modal-actions"><button className="ghost-button" type="button" onClick={clearFilters}>Clear</button><button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Apply</button></div></div></ModalShell> : null}
      {branchManagerOpen ? <ModalShell title="Manage branch items" onClose={() => setBranchManagerOpen(false)}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-branch-manager-form"><input className="text-input compact-text-input" placeholder="Full name" value={newBranchFullName} onChange={(event) => setNewBranchFullName(event.target.value)} /><input className="text-input compact-text-input" maxLength={5} placeholder="Abbrev." value={newBranchAbbreviation} onChange={(event) => setNewBranchAbbreviation(event.target.value.toUpperCase().slice(0, 5))} /><input className="color-input compact-color-input" type="color" value={newBranchColor} onChange={(event) => setNewBranchColor(event.target.value)} /><button className="primary-button compact-manager-button" type="button" onClick={addBranchOption}>Add</button></div><div className="branch-preview-list is-editor">{branchOptions.map((option) => <div className="branch-editor-row compact-branch-editor-row" key={option.optionKey || option.abbreviation}><input className="text-input compact-text-input compact-name-input" value={branchDrafts[option.abbreviation]?.fullName ?? option.fullName} onChange={(event) => updateBranchDraft(option.abbreviation, 'fullName', event.target.value)} /><input className="text-input compact-text-input" maxLength={5} value={branchDrafts[option.abbreviation]?.abbreviation ?? option.abbreviation} onChange={(event) => updateBranchDraft(option.abbreviation, 'abbreviation', event.target.value)} /><input className="color-input compact-color-input" type="color" value={branchDrafts[option.abbreviation]?.color ?? option.color} onChange={(event) => updateBranchDraft(option.abbreviation, 'color', event.target.value)} /><span className="branch-color-chip compact-branch-color-chip" style={{ background: branchDrafts[option.abbreviation]?.color ?? option.color, color: getContrastColor(branchDrafts[option.abbreviation]?.color ?? option.color) }} title={branchDrafts[option.abbreviation]?.fullName ?? option.fullName}>{branchDrafts[option.abbreviation]?.abbreviation ?? option.abbreviation}</span><div className="manager-action-group"><button className="ghost-button compact-manager-button" type="button" onClick={() => saveBranchOption(option.abbreviation)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteBranchOption(option.abbreviation)}>Delete</button></div></div>)}</div></div></ModalShell> : null}
      {branchEditorEventId && selectedBranchEvent ? <ModalShell title="Select branch" onClose={() => setBranchEditorEventId(null)}><div className="branch-manager"><div className="branch-selector-list">{branchOptions.map((option) => <button className={["branch-selector-item", selectedBranchEvent.branch.includes(option.abbreviation) ? "is-selected" : ""].join(" ").trim()} key={option.optionKey || option.abbreviation} type="button" title={option.fullName} onClick={() => toggleBranchOnEvent(selectedBranchEvent.id, option.abbreviation)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.abbreviation}</span></button>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setBranchEditorEventId(null)}>Done</button></div></div></ModalShell> : null}
      {productManagerOpen ? <ModalShell title="Manage product items" onClose={() => setProductManagerOpen(false)}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-product-manager-form"><input className="text-input compact-text-input" placeholder="Full name" value={newProductFullName} onChange={(event) => { const value = event.target.value; setNewProductFullName(value); setNewProductAbbreviation((current) => (current ? current : abbreviateLabel(value))); }} /><input className="text-input compact-text-input" maxLength={5} placeholder="Abbrev." value={newProductAbbreviation || abbreviateLabel(newProductFullName)} onChange={(event) => setNewProductAbbreviation(event.target.value.toUpperCase().slice(0, 5))} /><input className="color-input compact-color-input" type="color" value={newProductColor} onChange={(event) => setNewProductColor(event.target.value)} /><button className="primary-button compact-manager-button" type="button" onClick={addProductOption}>Add</button></div><div className="branch-preview-list is-editor">{productOptions.map((option) => <div className="branch-editor-row compact-product-editor-row" key={option.optionKey || option.abbreviation}><input className="text-input compact-text-input compact-name-input" value={productDrafts[option.optionKey || option.abbreviation]?.fullName ?? option.fullName} onChange={(event) => updateProductDraft(option.optionKey || option.abbreviation, 'fullName', event.target.value)} /><input className="text-input compact-text-input" maxLength={5} value={productDrafts[option.optionKey || option.abbreviation]?.abbreviation ?? option.abbreviation} onChange={(event) => updateProductDraft(option.optionKey || option.abbreviation, 'abbreviation', event.target.value)} /><input className="color-input compact-color-input" type="color" value={productDrafts[option.optionKey || option.abbreviation]?.color ?? option.color} onChange={(event) => updateProductDraft(option.optionKey || option.abbreviation, 'color', event.target.value)} /><span className="branch-color-chip compact-branch-color-chip" style={{ background: productDrafts[option.optionKey || option.abbreviation]?.color ?? option.color, color: getContrastColor(productDrafts[option.optionKey || option.abbreviation]?.color ?? option.color) }} title={productDrafts[option.optionKey || option.abbreviation]?.fullName ?? option.fullName}>{productDrafts[option.optionKey || option.abbreviation]?.abbreviation ?? option.abbreviation}</span><div className="manager-action-group"><button className="ghost-button compact-manager-button" type="button" onClick={() => saveProductOption(option.optionKey || option.abbreviation)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteProductOption(option.optionKey || option.abbreviation)}>Delete</button></div></div>)}</div></div></ModalShell> : null}
      {productEditorEventId && selectedProductEvent ? <ModalShell title="Select product" onClose={() => setProductEditorEventId(null)}><div className="branch-manager"><div className="branch-selector-list">{productOptions.map((option) => <button className={["branch-selector-item", selectedProductEvent.products.includes(option.abbreviation) ? "is-selected" : ""].join(" ").trim()} key={option.optionKey || option.abbreviation} type="button" title={option.fullName} onClick={() => toggleProductOnEvent(selectedProductEvent.id, option.abbreviation)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.abbreviation}</span></button>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setProductEditorEventId(null)}>Done</button></div></div></ModalShell> : null}
      {statusManagerOpen ? <ModalShell title="Manage status items" onClose={() => setStatusManagerOpen(false)}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-status-manager-form"><input className="text-input compact-text-input" maxLength={15} placeholder="Status name" value={newStatusName} onChange={(event) => setNewStatusName(event.target.value.slice(0, 15))} /><input className="color-input compact-color-input" type="color" value={newStatusColor} onChange={(event) => setNewStatusColor(event.target.value)} /><button className="primary-button compact-manager-button" type="button" onClick={addStatusOption}>Add</button></div><div className="branch-preview-list is-editor">{statusOptions.map((option) => <div className="branch-editor-row compact-status-editor-row" key={option.name}><input className="text-input compact-text-input" maxLength={15} value={statusDrafts[option.name]?.name ?? option.name} onChange={(event) => updateStatusDraft(option.name, 'name', event.target.value)} /><input className="color-input compact-color-input" type="color" value={statusDrafts[option.name]?.color ?? option.color} onChange={(event) => updateStatusDraft(option.name, 'color', event.target.value)} /><span className="branch-color-chip compact-branch-color-chip" style={{ background: statusDrafts[option.name]?.color ?? option.color, color: getContrastColor(statusDrafts[option.name]?.color ?? option.color) }}>{statusDrafts[option.name]?.name ?? option.name}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveStatusOption(option.name)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteStatusOption(option.name)}>Delete</button></div>)}</div></div></ModalShell> : null}
      {statusEditorEventId && selectedStatusEvent ? <ModalShell title="Select status" onClose={() => setStatusEditorEventId(null)}><div className="branch-manager"><div className="branch-selector-list">{statusOptions.map((option) => <button className={["branch-selector-item", selectedStatusEvent.status === option.name ? "is-selected" : ""].join(" ").trim()} key={option.name} type="button" onClick={() => selectStatusOnEvent(selectedStatusEvent.id, option.name)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.name}</span></button>)}</div></div></ModalShell> : null}
      {managedSingleManagerKey ? <ModalShell title={`Manage ${columnTitle(managedSingleManagerKey)} items`} onClose={() => setManagedSingleManagerKey('')}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-status-manager-form"><input className="text-input compact-text-input" maxLength={15} placeholder="Name" value={newManagedOptionName} onChange={(event) => setNewManagedOptionName(event.target.value.slice(0, 15))} /><input className="color-input compact-color-input" type="color" value={newManagedOptionColor} onChange={(event) => setNewManagedOptionColor(event.target.value)} /><button className="primary-button compact-manager-button" type="button" onClick={addManagedSingleOption}>Add</button></div><div className="branch-preview-list is-editor">{(managedSingleOptions[managedSingleManagerKey] || []).map((option) => <div className="branch-editor-row compact-status-editor-row" key={option.name}><input className="text-input compact-text-input" maxLength={15} value={((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.name) ?? option.name} onChange={(event) => updateManagedSingleDraft(managedSingleManagerKey, option.name, 'name', event.target.value)} /><input className="color-input compact-color-input" type="color" value={((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.color) ?? option.color} onChange={(event) => updateManagedSingleDraft(managedSingleManagerKey, option.name, 'color', event.target.value)} /><span className="branch-color-chip compact-branch-color-chip" style={{ background: ((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.color) ?? option.color, color: getContrastColor(((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.color) ?? option.color) }}>{((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.name) ?? option.name}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveManagedSingleOption(managedSingleManagerKey, option.name)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteManagedSingleOption(managedSingleManagerKey, option.name)}>Delete</button></div>)}</div></div></ModalShell> : null}
      {managedSingleEditor.columnKey && selectedManagedSingleEvent ? <ModalShell title={`Select ${columnTitle(managedSingleEditor.columnKey)}`} onClose={() => setManagedSingleEditor({ columnKey: '', eventId: '' })}><div className="branch-manager"><div className="branch-selector-list">{(managedSingleOptions[managedSingleEditor.columnKey] || []).map((option) => <button className={["branch-selector-item", selectedManagedSingleEvent[managedSingleEditor.columnKey] === option.name ? "is-selected" : ""].join(" ").trim()} key={option.name} type="button" onClick={() => selectManagedSingleValue(managedSingleEditor.columnKey, selectedManagedSingleEvent.id, option.name)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.name}</span></button>)}</div></div></ModalShell> : null}{customOptionManagerKey ? <ModalShell title={`Manage ${displayColumnLabel(customColumns.find((column) => column.key === customOptionManagerKey) || { label: customOptionManagerKey, isCustom: true })} items`} onClose={() => setCustomOptionManagerKey('')}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-status-manager-form"><input className="text-input compact-text-input" maxLength={40} placeholder="Name" value={newCustomOptionName} onChange={(event) => setNewCustomOptionName(event.target.value.slice(0, 40))} /><input className="color-input compact-color-input" type="color" value={newCustomOptionColor} onChange={(event) => setNewCustomOptionColor(event.target.value)} /><button className="primary-button compact-manager-button" type="button" onClick={addCustomOption}>Add</button></div><div className="branch-preview-list is-editor">{(customItemOptionsByColumn[customOptionManagerKey] || []).map((option) => <div className="branch-editor-row compact-status-editor-row" key={option.optionKey}><input className="text-input compact-text-input" maxLength={40} value={((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.name) ?? option.name} onChange={(event) => updateCustomOptionDraft(customOptionManagerKey, option.optionKey, 'name', event.target.value)} /><input className="color-input compact-color-input" type="color" value={((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.color) ?? option.color} onChange={(event) => updateCustomOptionDraft(customOptionManagerKey, option.optionKey, 'color', event.target.value)} /><span className="branch-color-chip compact-branch-color-chip" style={{ background: ((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.color) ?? option.color, color: getContrastColor(((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.color) ?? option.color) }}>{((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.name) ?? option.name}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveCustomOption(customOptionManagerKey, option.optionKey)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteCustomOption(customOptionManagerKey, option.optionKey)}>Delete</button></div>)}</div></div></ModalShell> : null}{customOptionEditor.columnKey && selectedCustomOptionEvent ? <ModalShell title={`Select ${displayColumnLabel(customColumns.find((column) => column.key === customOptionEditor.columnKey) || { label: customOptionEditor.columnKey, isCustom: true })}`} onClose={() => setCustomOptionEditor({ columnKey: '', eventId: '' })}><div className="branch-manager"><div className="branch-selector-list">{(customItemOptionsByColumn[customOptionEditor.columnKey] || []).map((option) => <button className={["branch-selector-item", customColumns.find((column) => column.key === customOptionEditor.columnKey)?.type === 'multiItem' ? (((selectedCustomOptionEvent.customFields || {})[customOptionEditor.columnKey] || []).includes(option.name) ? "is-selected" : "") : (((selectedCustomOptionEvent.customFields || {})[customOptionEditor.columnKey] === option.name) ? "is-selected" : "")].join(" ").trim()} key={option.optionKey} type="button" onClick={() => customColumns.find((column) => column.key === customOptionEditor.columnKey)?.type === 'multiItem' ? toggleCustomMultiValue(customOptionEditor.columnKey, selectedCustomOptionEvent.id, option.name) : selectCustomSingleValue(customOptionEditor.columnKey, selectedCustomOptionEvent.id, option.name)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.name}</span></button>)}</div>{customColumns.find((column) => column.key === customOptionEditor.columnKey)?.type === 'multiItem' ? <div className="modal-actions"><button className="primary-button" type="button" onClick={() => setCustomOptionEditor({ columnKey: '', eventId: '' })}>Done</button></div> : null}</div></ModalShell> : null}
      {attendantManagerOpen ? <ModalShell title="Manage attendant items" onClose={() => setAttendantManagerOpen(false)}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-attendant-manager-form"><input className="text-input compact-text-input" maxLength={100} placeholder="Full name" value={newAttendantName} onChange={(event) => setNewAttendantName(event.target.value.slice(0, 100))} /><button className="primary-button compact-manager-button" type="button" onClick={addAttendantOption}>Add</button></div><div className="branch-preview-list is-editor">{attendantOptions.map((option) => <div className="branch-editor-row compact-attendant-editor-row" key={option.fullName}><input className="text-input compact-text-input" maxLength={100} value={attendantDrafts[option.fullName]?.fullName ?? option.fullName} onChange={(event) => updateAttendantDraft(option.fullName, event.target.value)} /><span className="attendant-preview-chip" title={attendantDrafts[option.fullName]?.fullName ?? option.fullName}>{truncateName(attendantDrafts[option.fullName]?.fullName ?? option.fullName)}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveAttendantOption(option.fullName)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteAttendantOption(option.fullName)}>Delete</button></div>)}</div></div></ModalShell> : null}
      {attendantEditorEventId && selectedAttendantEvent ? <ModalShell title="Select attendant/s" onClose={() => setAttendantEditorEventId('')}><div className="branch-manager"><div className="branch-selector-list">{attendantOptions.map((option) => <button className={["branch-selector-item", (selectedAttendantEvent.attendants || []).includes(option.fullName) ? "is-selected" : ""].join(" ").trim()} key={option.fullName} type="button" title={option.fullName} onClick={() => toggleAttendantOnEvent(selectedAttendantEvent.id, option.fullName)}><span className="attendant-selector-name">{truncateName(option.fullName)}</span></button>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setAttendantEditorEventId('')}>Done</button></div></div></ModalShell> : null}
      {showAddColumnModal ? <ModalShell title="Add new column" onClose={() => setShowAddColumnModal(false)}><form className="simple-stack" onSubmit={handleAddCustomColumn}><label><span>Column name</span><input className="text-input" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} autoFocus /></label><label><span>Column type</span><select value={newColumnType} onChange={(event) => setNewColumnType(event.target.value)}>{CUSTOM_COLUMN_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setShowAddColumnModal(false)}>Cancel</button><button className="primary-button" type="submit">Add column</button></div></form></ModalShell> : null}{showAddModal ? <ModalShell title="Add new event" onClose={() => setShowAddModal(false)}><form className="modal-form" onSubmit={handleAddEvent}>{renderEventFields(eventForm, setEventForm, branchAbbreviations, branchFullNames, productAbbreviations, productFullNames, statusNames, getManagedOptionNames(managedSingleOptions, 'paymentStatus'), getManagedOptionNames(managedSingleOptions, 'vinyl'), attendantNames, openLocationPreview)}<div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setShowAddModal(false)}>Cancel</button><button className="primary-button" type="submit">Save event</button></div></form></ModalShell> : null}
      {showProfileModal ? <ModalShell title="Profile" onClose={() => setShowProfileModal(false)} hideCloseButton><div className="profile-modal"><section className="profile-hero"><div className="profile-avatar-shell">{profileForm.profilePic ? <img className="profile-avatar-image" src={profileForm.profilePic} alt="Profile" /> : <div className="profile-avatar-fallback">{`${profileForm.firstName?.[0] || currentUser.firstName?.[0] || ''}${profileForm.surname?.[0] || currentUser.surname?.[0] || ''}`.toUpperCase() || 'SB'}</div>}</div><div className="profile-hero-copy"><strong>{profileForm.firstName || currentUser.firstName} {profileForm.surname || currentUser.surname}</strong><span>{profileForm.designation || currentUser.designation}</span><div className="profile-upload-stack"><label className="profile-upload-button">{profileForm.profilePic ? 'Change profile photo' : 'Upload profile photo'}<input type="file" accept="image/*" onChange={(event) => handleProfileImageChange(event, setProfileForm)} /></label><small>Maximum file size: 1 MB</small></div></div></section><div className="profile-edit-grid"><label><span>Name</span><input className="text-input" value={profileForm.firstName} onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))} /></label><label><span>Surname</span><input className="text-input" value={profileForm.surname} onChange={(event) => setProfileForm((current) => ({ ...current, surname: event.target.value }))} /></label><label className="full-span"><span>Designation</span><input className="text-input" value={profileForm.designation} onChange={(event) => setProfileForm((current) => ({ ...current, designation: event.target.value }))} /></label><label><span>Email</span><input className="text-input locked-input" value={profileForm.email} readOnly /></label><label><span>Role</span><input className="text-input locked-input" value={profileForm.role} readOnly /></label></div><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => { setShowProfileModal(false); void signOut(); }}>Logout</button><button className="ghost-button" type="button" onClick={() => setShowProfileModal(false)}>Cancel</button><button className="primary-button" type="button" onClick={saveProfile}>Save profile</button></div></div></ModalShell> : null}
      {showUsersModal ? <ModalShell title="Manage users" onClose={() => setShowUsersModal(false)}><div className="users-modal">{users.map((user) => <button className="user-list-card" type="button" key={user.id} onClick={() => openUserEditor(user.id)}><div className="user-list-avatar">{`${user.firstName?.[0] || ''}${user.surname?.[0] || ''}`.toUpperCase() || 'SB'}</div><div className="user-list-copy"><strong>{user.firstName} {user.surname}</strong><span>{user.email}</span></div><div className="user-list-meta"><span className={`role-pill role-${user.role}`}>{formatRole(user.role)}</span><small>{user.isApproved ? 'Approved' : 'Pending'}</small></div></button>)}</div></ModalShell> : null}
      {editingUser ? <ModalShell title="User profile" onClose={() => setEditingUserId('')} hideCloseButton><div className="profile-modal"><section className="profile-hero"><div className="profile-avatar-shell">{managedUserForm.profilePic ? <img className="profile-avatar-image" src={managedUserForm.profilePic} alt="User profile" /> : <div className="profile-avatar-fallback">{`${managedUserForm.firstName?.[0] || editingUser.firstName?.[0] || ''}${managedUserForm.surname?.[0] || editingUser.surname?.[0] || ''}`.toUpperCase() || 'SB'}</div>}</div><div className="profile-hero-copy"><strong>{managedUserForm.firstName || editingUser.firstName} {managedUserForm.surname || editingUser.surname}</strong><span>{managedUserForm.designation || editingUser.designation}</span><div className="profile-upload-stack"><label className="profile-upload-button">{managedUserForm.profilePic ? 'Change profile photo' : 'Upload profile photo'}<input type="file" accept="image/*" onChange={(event) => handleProfileImageChange(event, setManagedUserForm)} /></label><small>Maximum file size: 1 MB</small></div></div></section><div className="profile-edit-grid"><label><span>Name</span><input className="text-input" value={managedUserForm.firstName} onChange={(event) => setManagedUserForm((current) => ({ ...current, firstName: event.target.value }))} /></label><label><span>Surname</span><input className="text-input" value={managedUserForm.surname} onChange={(event) => setManagedUserForm((current) => ({ ...current, surname: event.target.value }))} /></label><label className="full-span"><span>Designation</span><input className="text-input" value={managedUserForm.designation} onChange={(event) => setManagedUserForm((current) => ({ ...current, designation: event.target.value }))} /></label><label className="full-span"><span>Email</span><input className="text-input" value={managedUserForm.email} onChange={(event) => setManagedUserForm((current) => ({ ...current, email: event.target.value }))} /></label><label><span>Role</span><select value={managedUserForm.role} onChange={(event) => setManagedUserForm((current) => ({ ...current, role: event.target.value }))}>{ROLE_OPTIONS.map((role) => <option key={role} value={role}>{formatRole(role)}</option>)}</select></label><label className="approval-toggle"><span>Approve / Activate</span><input type="checkbox" checked={managedUserForm.isApproved} onChange={(event) => setManagedUserForm((current) => ({ ...current, isApproved: event.target.checked }))} /><strong>{managedUserForm.isApproved ? 'Approved' : 'Pending approval'}</strong></label></div><div className="modal-actions profile-admin-actions"><button className="ghost-button" type="button" onClick={() => setEditingUserId('')}>Cancel</button><button className="branch-delete-button danger-button" type="button" onClick={deleteManagedUser}>Delete user</button><button className="primary-button" type="button" onClick={saveManagedUser}>Save user</button></div></div></ModalShell> : null}
      {showWorkspaceModal ? <div className="modal-scrim" onClick={() => setShowWorkspaceModal(false)}><div className="modal-panel add-year-panel" role="dialog" aria-modal="true" aria-label="Add year" onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>Add year</h3></div><div className="simple-stack add-year-confirm"><p>Are you sure you want to add {nextWorkspaceYear}?</p><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setShowWorkspaceModal(false)}>No</button><button className="primary-button" type="button" onClick={handleCreateWorkspace}>Yes</button></div></div></div></div> : null}
      {confirmDialog.isOpen ? <ModalShell title={confirmDialog.title} onClose={() => closeConfirmation(false)}><div className="simple-stack"><p>{confirmDialog.message}</p><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => closeConfirmation(false)}>Cancel</button><button className={confirmDialog.tone === 'danger' ? 'branch-delete-button danger-button' : 'primary-button'} type="button" onClick={() => closeConfirmation(true)}>{confirmDialog.confirmLabel}</button></div></div></ModalShell> : null}
    </div>
  );
}

function renderPinIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-5.5-5.64-5.5-10A5.5 5.5 0 0 1 12 5.5 5.5 5.5 0 0 1 17.5 11c0 4.36-5.5 10-5.5 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="currentColor" /></svg>;
}

function renderSearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm8.91 11.5 2.3 2.29-1.42 1.42-2.29-2.3 1.41-1.41Z" fill="currentColor" /></svg>;
}

function buildGoogleMapsExternalUrl(location) {
  if (typeof location?.locationLat === 'number' && typeof location?.locationLng === 'number') {
    return 'https://www.google.com/maps/search/?api=1&query=' + location.locationLat + ',' + location.locationLng;
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location?.address || location?.location || '');
}

function LocationInputField({ value, title, placeholder, readOnly, className = 'inline-input', compact = false, onFocus, onTextChange, onPlaceSelect, onOpenMap, hasCoordinates }) {
  const wrapperRef = useRef(null);
  const autocompleteContainerRef = useRef(null);
  const autocompleteElementRef = useRef(null);
  const placeSelectHandlerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (wrapperRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => () => {
    if (autocompleteElementRef.current && placeSelectHandlerRef.current) {
      autocompleteElementRef.current.removeEventListener('gmp-select', placeSelectHandlerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || readOnly || !hasGoogleMapsApiKey()) {
      return undefined;
    }

    let isMounted = true;

    const mountAutocomplete = async () => {
      try {
        await loadGoogleMapsApi();
        if (!isMounted || !autocompleteContainerRef.current || !window.google?.maps?.importLibrary) {
          return;
        }

        const placesLibrary = await window.google.maps.importLibrary('places');
        const PlaceAutocompleteElement = placesLibrary?.PlaceAutocompleteElement;
        if (!PlaceAutocompleteElement || !autocompleteContainerRef.current) {
          return;
        }

        if (!autocompleteElementRef.current) {
          const element = new PlaceAutocompleteElement();
          element.className = compact ? 'sb-place-autocomplete compact' : 'sb-place-autocomplete';
          element.setAttribute('aria-label', 'Search address');
          element.includedRegionCodes = ['za'];
          if (placeholder) {
            element.setAttribute('placeholder', placeholder);
          }

          const handlePlaceSelect = async (event) => {
            try {
              const prediction = event.placePrediction;
              const place = prediction?.toPlace ? prediction.toPlace() : null;
              if (!place) {
                return;
              }
              if (place.fetchFields) {
                await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
              }
              onPlaceSelect?.(extractPlaceResult(place, value || '', prediction?.placeId || ''));
              setIsOpen(false);
            } catch (error) {
              console.error('Google place selection failed', error);
            }
          };

          autocompleteElementRef.current = element;
          placeSelectHandlerRef.current = handlePlaceSelect;
          element.addEventListener('gmp-select', handlePlaceSelect);
        }

        if (!autocompleteContainerRef.current.contains(autocompleteElementRef.current)) {
          autocompleteContainerRef.current.innerHTML = '';
          autocompleteContainerRef.current.appendChild(autocompleteElementRef.current);
        }

        window.setTimeout(() => {
          autocompleteElementRef.current?.focus?.();
        }, 0);
      } catch (error) {
        console.error('Google Maps autocomplete failed to load', error);
      }
    };

    void mountAutocomplete();

    return () => {
      isMounted = false;
    };
  }, [compact, isOpen, onPlaceSelect, placeholder, readOnly, value]);

  return <div ref={wrapperRef} className={[compact ? 'location-field compact' : 'location-field', hasCoordinates ? 'has-pin' : '', isOpen ? 'is-open' : ''].join(' ').trim()}><input className={className} title={title || value || ''} value={value || ''} readOnly={readOnly} placeholder={placeholder} onFocus={onFocus} onChange={(event) => onTextChange?.(event.target.value)} />{!readOnly && hasGoogleMapsApiKey() ? <button className="location-search-button" type="button" title="Search with Google Maps" onClick={() => setIsOpen((current) => !current)}>{renderSearchIcon()}</button> : null}{hasCoordinates ? <button className="location-pin-button" type="button" title="View map" onClick={onOpenMap}>{renderPinIcon()}</button> : null}{isOpen ? <div className="location-autocomplete-popover"><div ref={autocompleteContainerRef} className="location-autocomplete-host" /><button className="ghost-button location-autocomplete-close" type="button" onClick={() => setIsOpen(false)}>Close</button></div> : null}</div>;
}

function LocationMapPreview({ location }) {
  const mapRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    let marker = null;

    void loadGoogleMapsApi().then(() => {
      if (!isActive || !mapRef.current || !window.google?.maps || typeof location?.locationLat !== 'number' || typeof location?.locationLng !== 'number') {
        return;
      }

      const center = { lat: location.locationLat, lng: location.locationLng };
      const map = new window.google.maps.Map(mapRef.current, {
        center,
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      marker = new window.google.maps.Marker({ position: center, map });
    }).catch((error) => {
      console.error('Google Maps preview failed to load', error);
    });

    return () => {
      isActive = false;
      if (marker?.setMap) {
        marker.setMap(null);
      }
    };
  }, [location]);

  return <div className="map-preview-canvas" ref={mapRef} />;
}

function renderEventFields(form, setForm, branchAbbreviations, branchFullNames, productAbbreviations, productFullNames, statusNames, paymentNames, yesNoNames, attendantNames, openLocationPreview) {
  return <><label><span>Name / Item</span><input className="text-input" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Event name</span><input className="text-input" placeholder="Event Name" value={form.eventTitle || ''} onChange={(event) => setForm((current) => ({ ...current, eventTitle: event.target.value }))} /></label><label><span>Date</span><input className="text-input" type="date" required value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label><label><span>Hours</span><input className="text-input" value={form.hours} onChange={(event) => setForm((current) => ({ ...current, hours: event.target.value }))} /></label><label><span>Branch</span><select value={form.branch[0]} onChange={(event) => setForm((current) => ({ ...current, branch: [event.target.value] }))}>{branchAbbreviations.map((option) => <option key={option} value={option} title={branchFullNames[option] || option}>{option}</option>)}</select></label><label><span>Product</span><select value={form.products[0] || ''} onChange={(event) => setForm((current) => ({ ...current, products: event.target.value ? [event.target.value] : [] }))}><option value=''>Select product</option>{productAbbreviations.map((option) => <option key={option} value={option} title={productFullNames[option] || option}>{option}</option>)}</select></label><label><span>Status</span><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{statusNames.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="full-span"><span>Location</span><LocationInputField value={form.location || ''} placeholder='Start typing address' className='text-input' onTextChange={(nextValue) => setForm((current) => ({ ...current, location: nextValue, locationPlaceId: '', locationLat: null, locationLng: null }))} onPlaceSelect={(place) => setForm((current) => ({ ...current, ...place }))} onOpenMap={() => openLocationPreview({ name: form.name || 'New event', location: form.location || '', locationLat: form.locationLat, locationLng: form.locationLng })} hasCoordinates={typeof form.locationLat === 'number' && typeof form.locationLng === 'number'} /></label><label><span>Payment</span><select value={form.paymentStatus} onChange={(event) => setForm((current) => ({ ...current, paymentStatus: event.target.value }))}>{paymentNames.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label><span>Vinyl</span><select value={form.vinyl} onChange={(event) => setForm((current) => ({ ...current, vinyl: event.target.value }))}>{yesNoNames.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label><span>GS / AI</span><select value={form.gsAi} onChange={(event) => setForm((current) => ({ ...current, gsAi: event.target.value }))}>{yesNoNames.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label><span>Images sent</span><select value={form.imagesSent} onChange={(event) => setForm((current) => ({ ...current, imagesSent: event.target.value }))}>{yesNoNames.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label><span>Snappic</span><select value={form.snappic} onChange={(event) => setForm((current) => ({ ...current, snappic: event.target.value }))}>{yesNoNames.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label><span>Attendant/s</span><select value={form.attendants[0] || ''} onChange={(event) => setForm((current) => ({ ...current, attendants: event.target.value ? [event.target.value] : [] }))}><option value="">Select attendant</option>{attendantNames.map((option) => <option key={option} value={option} title={option}>{option}</option>)}</select></label><label><span>Ex. VAT</span><input className="text-input" value={form.exVat} onChange={(event) => setForm((current) => ({ ...current, exVat: event.target.value }))} /></label><label><span>Package only</span><input className="text-input" value={form.packageOnly} onChange={(event) => setForm((current) => ({ ...current, packageOnly: event.target.value }))} /></label></>;
}
function renderCell({ columnKey, event, openDrawer, updateEventField, updateEventLocationText, applyEventLocation, updateEventCustomField, dateEditor, setDateEditor, openDateEditor, closeDateEditor, applyEventDate, openBranchSelector, openProductSelector, openStatusSelector, openManagedSingleSelector, openAttendantSelector, openCustomOptionSelector, branchStyles, branchFullNames, productStyles, productFullNames, statusStyles, managedSingleStyles, customItemStyles, customColumns, customSingleTagWidths, setActiveRowId, openLocationPreview, canEdit }) {
    if (columnKey === 'name') return <div className="name-cell"><button className="plus-trigger" type="button" onClick={() => openDrawer(event.id)}>...</button><div className="name-cell-copy"><input className="inline-input inline-name" title={event.name} value={event.name} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'name', inputEvent.target.value)} /><input className="inline-input inline-event-title" title={event.eventTitle || ''} placeholder="Event Name" value={event.eventTitle || ''} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'eventTitle', inputEvent.target.value)} /></div></div>;
  if (columnKey === 'hours') return <input className="inline-input" title={event.hours} value={event.hours} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'hours', inputEvent.target.value)} />;
  if (columnKey === 'location') return <LocationInputField value={event.location || ''} title={event.location || ''} readOnly={!canEdit} placeholder='Start typing address' onFocus={() => setActiveRowId(event.id)} onTextChange={(nextValue) => updateEventLocationText(event.id, nextValue)} onPlaceSelect={(place) => applyEventLocation(event.id, place)} onOpenMap={() => openLocationPreview(event)} hasCoordinates={typeof event.locationLat === 'number' && typeof event.locationLng === 'number'} compact />;
  if (columnKey === 'exVat') return <input className="inline-input inline-number" value={event.exVat ?? ''} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'exVat', inputEvent.target.value)} />;
  if (columnKey === 'packageOnly') return <input className="inline-input inline-number" value={event.packageOnly ?? ''} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'packageOnly', inputEvent.target.value)} />;
  if (columnKey === 'date') return dateEditor.eventId === event.id && dateEditor.columnKey === 'date' ? <DateInlineEditor value={dateEditor.value} onChange={(nextValue) => setDateEditor((current) => ({ ...current, value: nextValue }))} onCancel={closeDateEditor} onApply={() => applyEventDate(event.id, dateEditor.value, 'date')} /> : <button className='cell-select-button date-cell-button' type='button' title={event.date || ''} disabled={!canEdit} onClick={() => openDateEditor(event, 'date')}><span>{formatDateDisplay(event.date) || 'Pick date'}</span></button>;
  if (columnKey === 'branch') return <button className='cell-select-button' type='button' title={event.branch.map((item) => branchFullNames[item] || item).join(', ')} disabled={!canEdit} onClick={() => openBranchSelector(event.id)}><CompactTagList items={event.branch} styles={branchStyles} /></button>;
  if (columnKey === 'products') return <button className='cell-select-button' type='button' title={event.products.map((item) => productFullNames[item] || item).join(', ')} disabled={!canEdit} onClick={() => openProductSelector(event.id)}><CompactTagList items={event.products} styles={productStyles} /></button>;
  if (columnKey === 'status') return <button className='cell-select-button' type='button' title={event.status || ''} disabled={!canEdit} onClick={() => openStatusSelector(event.id)}><Tag value={event.status || ''} styles={statusStyles} placeholder='Select' /></button>;
  if (columnKey === 'paymentStatus') return <button className='cell-select-button' type='button' title={event.paymentStatus || ''} disabled={!canEdit} onClick={() => openManagedSingleSelector('paymentStatus', event.id)}><Tag value={event.paymentStatus || ''} styles={managedSingleStyles.paymentStatus || {}} placeholder='Select' /></button>;
  if (['vinyl', 'gsAi', 'imagesSent', 'snappic'].includes(columnKey)) return <button className='cell-select-button' type='button' title={event[columnKey] || ''} disabled={!canEdit} onClick={() => openManagedSingleSelector(columnKey, event.id)}><Tag value={event[columnKey] || ''} styles={managedSingleStyles[columnKey] || {}} placeholder='Select' /></button>;
  if (columnKey === 'attendants') return <button className='cell-select-button' type='button' title={(event.attendants || []).join(', ')} disabled={!canEdit} onClick={() => openAttendantSelector(event.id)}><CompactNameList items={event.attendants || []} /></button>;

  const customColumn = customColumns.find((column) => column.key === columnKey);
  if (customColumn) {
    const customValue = (event.customFields || {})[columnKey];
    if (customColumn.type === 'text') return <input className="inline-input" title={String(customValue || '')} value={String(customValue || '')} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventCustomField(event.id, columnKey, inputEvent.target.value)} />;
    if (customColumn.type === 'number') return <input className="inline-input inline-number" value={String(customValue || '')} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventCustomField(event.id, columnKey, inputEvent.target.value)} />;
    if (customColumn.type === 'date') return dateEditor.eventId === event.id && dateEditor.columnKey === columnKey ? <DateInlineEditor value={String(customValue || dateEditor.value || '')} onChange={(nextValue) => setDateEditor((current) => ({ ...current, value: nextValue }))} onCancel={closeDateEditor} onApply={() => applyEventDate(event.id, dateEditor.value, columnKey)} /> : <button className='cell-select-button date-cell-button' type='button' title={String(customValue || '')} disabled={!canEdit} onClick={() => openDateEditor(event, columnKey)}><span>{formatDateDisplay(String(customValue || '')) || 'Pick date'}</span></button>;
    if (customColumn.type === 'singleItem') return <button className='cell-select-button custom-single-select-button' style={customSingleTagWidths[columnKey] ? { width: customSingleTagWidths[columnKey], minWidth: customSingleTagWidths[columnKey] } : undefined} type='button' title={String(customValue || '')} disabled={!canEdit} onClick={() => openCustomOptionSelector(columnKey, event.id)}><CustomSingleTag value={String(customValue || '')} styles={customItemStyles[columnKey] || {}} width={customSingleTagWidths[columnKey]} placeholder='Select' /></button>;
    if (customColumn.type === 'multiItem') return <button className='cell-select-button' type='button' title={(Array.isArray(customValue) ? customValue : []).join(', ')} disabled={!canEdit} onClick={() => openCustomOptionSelector(columnKey, event.id)}><CompactTagList items={Array.isArray(customValue) ? customValue : []} styles={customItemStyles[columnKey] || {}} /></button>;
  }

  return <span title={String(event[columnKey] || '')}>{event[columnKey] || ''}</span>;
}

function getEventMonth(event) {
  if (event.date) {
    return monthNames[new Date(event.date).getMonth()];
  }
  return event.draftMonth || 'January';
}

function sortEvents(left, right) {
  const leftMonth = monthNames.indexOf(getEventMonth(left));
  const rightMonth = monthNames.indexOf(getEventMonth(right));
  if (leftMonth !== rightMonth) {
    return leftMonth - rightMonth;
  }
  const leftIsDraft = !left.date;
  const rightIsDraft = !right.date;
  if (leftIsDraft && rightIsDraft) {
    return String(left.id).localeCompare(String(right.id));
  }
  if (leftIsDraft) {
    return 1;
  }
  if (rightIsDraft) {
    return -1;
  }
  return new Date(left.date) - new Date(right.date);
}
function getContrastColor(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.7 ? '#233142' : '#ffffff';
}

function getManagedOptionNames(optionsByKey, columnKey) {
  return (optionsByKey[columnKey] || []).map((option) => option.name);
}

function getMonthOrderStorageKey(userId) {
  return `selfiebox-month-order-${userId}`;
}

function columnTitle(columnKey) {
  const titles = { paymentStatus: 'Payment', vinyl: 'Vinyl', gsAi: 'GS / AI', imagesSent: 'Images Sent', snappic: 'Snappic' };
  return titles[columnKey] || columnKey;
}

function getEventDayShadeClass(event) {
  const value = String(event?.date || '').trim();
  if (!value) {
    return '';
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const day = Number(isoMatch[3]);
    return day % 2 === 0 ? 'is-alt-day' : '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.getDate() % 2 === 0 ? 'is-alt-day' : '';
}

function DateInlineEditor({ value, onChange, onCancel, onApply }) {
  const [visibleMonth, setVisibleMonth] = useState(() => getCalendarMonth(value));

  useEffect(() => {
    setVisibleMonth(getCalendarMonth(value));
  }, [value]);

  const todayValue = toDateValue(new Date());
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < leadingDays; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateValue = toDateValue(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
    cells.push({ day, dateValue });
  }

  return <div className="date-inline-modal" onMouseDown={onCancel} onClick={onCancel}><div className="date-inline-popover calendar-popover" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    <div className="calendar-header">
      <button className="ghost-button calendar-nav" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>{'<'}</button>
      <strong>{visibleMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>
      <button className="ghost-button calendar-nav" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>{'>'}</button>
    </div>
    <div className="calendar-weekdays">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{cells.map((cell, index) => cell ? <button key={cell.dateValue} className={['calendar-day', value === cell.dateValue ? 'is-selected' : '', cell.dateValue < todayValue ? 'is-disabled' : ''].join(' ').trim()} type="button" disabled={cell.dateValue < todayValue} onClick={() => onChange(cell.dateValue)}>{cell.day}</button> : <span key={`blank-${index}`} className="calendar-day is-empty" />)}</div>
    <div className="date-inline-actions">
      <button className="ghost-button date-inline-button" type="button" onClick={onCancel}>Cancel</button>
      <button className="primary-button date-inline-button" type="button" onClick={onApply}>Apply</button>
    </div>
  </div></div>;
}

function formatDateDisplay(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return value;
  return day + '/' + month + '/' + year;
}

function getCalendarMonth(value) {
  if (!value) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const [year, month] = String(value).split('-');
  return new Date(Number(year), Number(month) - 1, 1);
}

function toDateValue(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function truncateName(value) {
  return String(value || '').slice(0, 15);
}

function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CompactNameList({ items }) {
  if (!items || items.length === 0) return <span className="empty-cell-value">Select</span>;
  const firstItem = items[0];
  const overflowCount = items.length - 1;
  return <div className="compact-name-wrap"><div className="compact-tag-slot"><span className="compact-name-pill" title={firstItem}>{truncateName(firstItem)}</span>{overflowCount > 0 ? <span className="extra-pill extra-pill-corner">+{overflowCount}</span> : null}</div></div>;
}

function CompactTagList({ items, styles }) {
  if (!items || items.length === 0) return <span className="empty-cell-value">Select</span>;
  const visibleItems = items.slice(0, 2);
  const overflowCount = items.length - visibleItems.length;
  return <div className="compact-tag-wrap">{visibleItems.map((item, index) => <div className="compact-tag-slot" key={String(item) + '-' + index}><Tag value={item} styles={styles} />{index === 1 && overflowCount > 0 ? <span className="extra-pill extra-pill-corner">+{overflowCount}</span> : null}</div>)}</div>;
}

function FilterGroup({ title, options, selected, onToggle }) {
  const shouldScroll = options.length > 10;
  return <section className="filter-group"><h4>{title}</h4><div className={["filter-options", shouldScroll ? "is-scrollable" : ""].join(" ").trim()}>{options.map((option) => <label key={option} className="filter-option"><input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} /><span>{option}</span></label>)}</div></section>;
}

function AuthShell({ authMode, setAuthMode }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">SelfieBox Events</div>
        <h1>{authMode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        <p>Log in with your email address to access the yearly event workspaces in your browser.</p>
        <div className="auth-tabs">
          <button className={authMode === 'login' ? 'is-active' : ''} type="button" onClick={() => setAuthMode('login')}>Login</button>
          <button className={authMode === 'register' ? 'is-active' : ''} type="button" onClick={() => setAuthMode('register')}>Register</button>
        </div>
        <div className="clerk-auth-shell">
          {authMode === 'login' ? <SignIn routing="hash" signUpUrl="#register" /> : <SignUp routing="hash" signInUrl="#login" />}
        </div>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">SelfieBox Events</div>
        <h1>Loading your account</h1>
        <p>Please wait while Clerk connects your session.</p>
      </div>
    </div>
  );
}

function App() {
  const [authMode, setAuthMode] = useState('login');

  return (
    <>
      <AuthLoading>
        <LoadingShell />
      </AuthLoading>
      <Unauthenticated>
        <AuthShell authMode={authMode} setAuthMode={setAuthMode} />
      </Unauthenticated>
      <Authenticated>
        <DashboardApp />
      </Authenticated>
    </>
  );
}

function ModalShell({ title, onClose, children, hideCloseButton = false }) {
  return <div className="modal-scrim" onClick={onClose}><div className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3>{!hideCloseButton ? <button className="modal-close-x" type="button" onClick={onClose}>x</button> : null}</div>{children}</div></div>;
}

function ActivityEntry({ entry, title, eventName = '' }) {
  return <article className="activity-item" key={entry.id}><div className="activity-item-body"><div className="activity-item-meta"><time>{entry.date}</time><span>-</span><span>{entry.user || 'Unknown user'}</span></div><p title={title}>{eventName ? <><strong>{eventName}</strong>{entry.text ? <> {entry.text}</> : null}</> : entry.text}</p></div></article>;
}

function CustomSingleTag({ value, styles, width, placeholder = 'Select' }) {
  const label = value || placeholder;
  const resolved = value ? (styles[value] || { background: '#d6d6d6', color: '#223042' }) : { background: '#eef1f5', color: '#60708b' };
  const pillStyle = width ? { ...resolved, width, minWidth: width, maxWidth: width, boxSizing: 'border-box' } : resolved;
  return <span className="custom-single-pill" style={pillStyle}>{label}</span>;
}

function Tag({ value, styles, width, placeholder = 'Select', className = '' }) {
  const baseStyle = width ? { width, minWidth: width, maxWidth: width, boxSizing: 'border-box' } : undefined;
  if (!value) {
    return <span className={["tag", "tag-empty", className].join(" ").trim()} style={baseStyle}>{placeholder}</span>;
  }
  const resolved = styles[value] || { background: '#d6d6d6', color: '#223042' };
  return <span className={["tag", className].join(" ").trim()} style={baseStyle ? { ...resolved, ...baseStyle } : resolved}>{value}</span>;
}

function formatRole(value) {
  const found = ROLE_OPTIONS.find((role) => role === value);
  return found ? found.charAt(0).toUpperCase() + found.slice(1) : value;
}

function abbreviateLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 5).toUpperCase();
}

function sanitizeProductLabel(value) {
  const text = String(value || '');
  const normalizedDegree = '360' + String.fromCharCode(176);
  return text
    .replace(/360\\u00C2\\u00B0/g, normalizedDegree)
    .replace(/360\\uFFFD/g, normalizedDegree)
    .replace(/360\?/g, normalizedDegree)
    .replace(/360°°/g, normalizedDegree)
    .replace(/\b360(?=\s)/g, normalizedDegree)
    .replace(/\s+/g, ' ')
    .trim();
}

function getProductIdentity(option) {
  return option?.optionKey || option?.abbreviation || '';
}

function getProductStoredValue(option) {
  return option?.abbreviation || option?.optionKey || '';
}

function isPreviewImage(file) {
  return file?.type === 'Image' || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file?.name || '');
}

function isPreviewPdf(file) {
  return file?.type === 'PDF' || /\.pdf$/i.test(file?.name || '');
}

function formatExportValue(columnKey, event, lookups) {
  if (columnKey === 'date') return formatDateDisplay(event.date);
  if (columnKey === 'branch') return (event.branch || []).map((item) => lookups.branchFullNames[item] || item).join(', ');
  if (columnKey === 'products') return (event.products || []).map((item) => lookups.productFullNames[item] || item).join(', ');
  if (columnKey === 'attendants') return (event.attendants || []).join(', ');
  if (lookups.column?.isCustom) {
    const customValue = (event.customFields || {})[columnKey];
    if (lookups.column.type === 'date') return formatDateDisplay(String(customValue || ''));
    if (Array.isArray(customValue)) return customValue.join(', ');
    return customValue == null ? '' : String(customValue);
  }
  return event[columnKey] == null ? '' : String(event[columnKey]);
}

function buildWorkbookXml({ sheets, headers }) {
  const worksheetXml = sheets.map((sheet) => {
    const rows = [headers, ...sheet.rows];
    const rowXml = rows.map((row) => '<Row>' + row.map((value) => '<Cell><Data ss:Type="String">' + escapeXml(value) + '</Data></Cell>').join('') + '</Row>').join('');
    return '<Worksheet ss:Name="' + escapeXml(sheet.name.slice(0, 31)) + '"><Table>' + rowXml + '</Table></Worksheet>';
  }).join('');

  return '<?xml version="1.0"?>' +
    '<?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">' +
    worksheetXml +
    '</Workbook>';
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function downloadWorkbookFile(filename, contents) {
  const blob = new Blob([contents], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
export default App;








