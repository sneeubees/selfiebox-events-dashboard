import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { Authenticated, AuthLoading, Unauthenticated, useAction, useMutation, useQuery } from 'convex/react';
import { api } from './convex/_generated/api';
import { extractPlaceResult, hasGoogleMapsApiKey, loadGoogleMapsApi, loadGooglePlacesLibrary } from './googleMaps';
import BookingPage, { getBookingTokenFromPath } from './BookingPage';
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

const PENDING_REGISTRATION_KEY = 'sb-pending-registration';

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
  accounts: 'singleItem',
  quoteNumber: 'text',
  invoiceNumber: 'text',
  exVatAuto: 'number',
  vinyl: 'singleItem',
  gsAi: 'singleItem',
  imagesSent: 'singleItem',
  snappic: 'singleItem',
  attendants: 'multiItem',
  exVat: 'number',
  packageOnly: 'number',
};
const EXTENDED_BOARD_COLUMNS = [
  ...BOARD_COLUMNS.slice(0, 8),
  { key: 'accounts', label: 'Accounts' },
  { key: 'quoteNumber', label: 'Quote Number' },
  { key: 'invoiceNumber', label: 'Invoice Number' },
  ...BOARD_COLUMNS.slice(8, 14),
  { key: 'exVatAuto', label: 'ExVAT Auto' },
  ...BOARD_COLUMNS.slice(14),
];
const STATIC_COLUMNS = EXTENDED_BOARD_COLUMNS.map((column) => ({
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
  date: '',
  draftMonth: '',
  hours: '',
  branch: [],
  products: [],
  status: '',
  location: '',
  locationPlaceId: '',
  locationLat: null,
  locationLng: null,
  paymentStatus: '',
  accounts: '',
  quoteNumber: '',
  invoiceNumber: '',
  exVatAuto: '',
  vinyl: '',
  gsAi: '',
  imagesSent: '',
  snappic: '',
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

const COLOR_SWATCHES = [
  '#ffffff',
  '#f5f5f5',
  '#d6d6d6',
  '#7b8794',
  '#233142',
  '#b8d9ff',
  '#cfe5ff',
  '#9cc7ff',
  '#6fa8ff',
  '#d9edf8',
  '#d8f3dc',
  '#95d5b2',
  '#23b26d',
  '#1b8f58',
  '#2b61d1',
  '#274582',
  '#fee2e2',
  '#fda4af',
  '#d93c56',
  '#be123c',
  '#fef3c7',
  '#f08c2e',
  '#d97706',
  '#dfe7f6',
  '#ffe1b8',
  '#c8ddf7',
  '#eadfb8',
  '#d7c8f5',
  '#c4b5fd',
  '#8b5cf6',
  '#fbcfe8',
  '#ec4899',
];

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});

function parseNumericCellValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const input = String(value ?? '').trim();
  if (!input) {
    return 0;
  }

  const compact = input.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (!compact) {
    return 0;
  }

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = compact.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimalDigits = compact.length - lastComma - 1;
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? compact.replace(/\./g, '').replace(/,/g, '.')
      : compact.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const decimalDigits = compact.length - lastDot - 1;
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? compact.replace(/,/g, '')
      : compact.replace(/\./g, '');
  }

  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getColumnWidth(column) {
  if (column.isCustom) {
    return 84;
  }
  if (column.key === 'name') return 260;
  if (column.key === 'date') return 70;
  if (column.key === 'hours') return 120;
  if (column.key === 'branch') return 100;
  if (column.key === 'products') return 136;
  if (column.key === 'status') return 132;
  if (column.key === 'location') return 230;
  if (column.key === 'paymentStatus') return 104;
  if (column.key === 'accounts') return 104;
  if (column.key === 'quoteNumber') return 96;
  if (column.key === 'invoiceNumber') return 96;
  if (column.key === 'exVatAuto') return 108;
  if (column.key === 'vinyl') return 116;
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
    accounts: event.accounts || '',
    quoteNumber: event.quoteNumber || '',
    invoiceNumber: event.invoiceNumber || '',
    exVatAuto: event.exVatAuto ?? '',
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
  const staticColumnLabelRecords = useQuery(api.staticColumnLabels.listAll, canAccessDashboard ? {} : 'skip');
  const currentColumnRights = useQuery(api.permissions.currentUserRights, canAccessDashboard ? {} : 'skip');
  const allColumnPermissions = useQuery(api.permissions.listAll, canAccessDashboard && currentUser?.role === 'admin' ? {} : 'skip');
  const syncCurrentUser = useMutation(api.users.syncCurrentUser);
  const updateMyProfile = useMutation(api.users.updateMyProfile);
  const updateMonthOrderMutation = useMutation(api.users.updateMonthOrder);
  const updateColumnOrderAfterPaymentMutation = useMutation(api.users.updateColumnOrderAfterPayment);
  const updateManagedUserMutation = useMutation(api.users.update);
  const updateStaticColumnLabelMutation = useMutation(api.staticColumnLabels.upsert);
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
  const extractUploadedDocumentNumber = useAction(api.documentNumbers.extractUploadedDocumentNumber);
  const removeUploadedEventFile = useMutation(api.files.removeFile);
  const migrateLegacyFiles = useMutation(api.files.migrateLegacyFiles);
  const generateBookingLinkMutation = useMutation(api.bookings.generateForEvent);
  const [selectedWorkspaceYear, setSelectedWorkspaceYear] = useState(2026);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState([]);
  const [savedFilterViews, setSavedFilterViews] = useState([]);
  const [saveFilterViewModalOpen, setSaveFilterViewModalOpen] = useState(false);
  const [newFilterViewName, setNewFilterViewName] = useState('');
  const [commissionDialog, setCommissionDialog] = useState({
    isOpen: false,
    month: '',
    attendant: '',
    period: 'all',
    overrides: {},
  });
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
  const [selectedAttendants, setSelectedAttendants] = useState([]);
  const [managedSingleOptions, setManagedSingleOptions] = useState({
    paymentStatus: defaultPaymentOptions,
    accounts: defaultPaymentOptions,
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
  const [attendantOptions, setAttendantOptions] = useState(() => Array.from(new Set(seedEvents.flatMap((event) => event.attendants || []))).map((fullName) => ({ fullName, branchKey: '' })));
  const [attendantManagerOpen, setAttendantManagerOpen] = useState(false);
  const [attendantEditorEventId, setAttendantEditorEventId] = useState('');
  const [newAttendantName, setNewAttendantName] = useState('');
  const [newAttendantBranch, setNewAttendantBranch] = useState('');
  const [attendantDrafts, setAttendantDrafts] = useState({});
  const [collapsedMonths, setCollapsedMonths] = useState({ January: true, February: true, March: false, April: true, May: true, June: true, July: true, August: true, September: true, October: true, November: true, December: true });
  const [monthOrder, setMonthOrder] = useState(monthNames);
  const [draggedMonth, setDraggedMonth] = useState('');
  const [dragOverMonth, setDragOverMonth] = useState('');
  const [columnOrderAfterPaymentDraft, setColumnOrderAfterPaymentDraft] = useState([]);
  const [draggedColumnKey, setDraggedColumnKey] = useState('');
  const [dragOverColumnKey, setDragOverColumnKey] = useState('');
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
  useEffect(() => {
    filtersHydratedRef.current = false;
    if (!currentUser?.id || typeof window === 'undefined') {
      setSavedFilterViews([]);
      setSelectedBranches([]);
      setSelectedProducts([]);
      setSelectedStatuses([]);
      setSelectedPayments([]);
      setSelectedAttendants([]);
      return;
    }

    try {
      const savedViewsRaw = window.localStorage.getItem(getSavedFilterViewsStorageKey(currentUser.id));
      const savedViewsParsed = savedViewsRaw ? JSON.parse(savedViewsRaw) : [];
      setSavedFilterViews(Array.isArray(savedViewsParsed) ? savedViewsParsed.slice(0, 8) : []);

      const activeFiltersRaw = window.localStorage.getItem(getActiveFilterStateStorageKey(currentUser.id));
      const activeFilters = activeFiltersRaw ? JSON.parse(activeFiltersRaw) : null;
      setSelectedBranches(Array.isArray(activeFilters?.branches) ? activeFilters.branches : []);
      setSelectedProducts(Array.isArray(activeFilters?.products) ? activeFilters.products : []);
      setSelectedStatuses(Array.isArray(activeFilters?.statuses) ? activeFilters.statuses : []);
      setSelectedPayments(Array.isArray(activeFilters?.payments) ? activeFilters.payments : []);
      setSelectedAttendants(Array.isArray(activeFilters?.attendants) ? activeFilters.attendants : []);
    } catch {
      setSavedFilterViews([]);
      setSelectedBranches([]);
      setSelectedProducts([]);
      setSelectedStatuses([]);
      setSelectedPayments([]);
      setSelectedAttendants([]);
    }

    filtersHydratedRef.current = true;
  }, [currentUser?.id]);
  useEffect(() => {
    if (!filtersHydratedRef.current || !currentUser?.id || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      getActiveFilterStateStorageKey(currentUser.id),
      JSON.stringify({
        branches: selectedBranches,
        products: selectedProducts,
        statuses: selectedStatuses,
        payments: selectedPayments,
        attendants: selectedAttendants,
      })
    );
  }, [currentUser?.id, selectedBranches, selectedProducts, selectedStatuses, selectedPayments, selectedAttendants]);
  useEffect(() => {
    if (!filtersHydratedRef.current || !currentUser?.id || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(getSavedFilterViewsStorageKey(currentUser.id), JSON.stringify(savedFilterViews.slice(0, 8)));
  }, [currentUser?.id, savedFilterViews]);
  useEffect(() => {
    setColumnOrderAfterPaymentDraft(currentUser?.columnOrderAfterPayment || []);
  }, [currentUser?.columnOrderAfterPayment]);
  const workspaceActivityEntries = useQuery(api.collaboration.listWorkspaceActivity, canAccessDashboard ? { workspaceYear: selectedWorkspaceYear } : 'skip');
  const eventUpdateEntries = useQuery(api.collaboration.listEventUpdates, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const eventActivityEntries = useQuery(api.collaboration.listEventActivity, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const eventFileEntries = useQuery(api.files.listEventFiles, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const eventBookingRecord = useQuery(api.bookings.getForEvent, canAccessDashboard && selectedId ? { eventKey: selectedId } : 'skip');
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('updates');
  const [draftUpdate, setDraftUpdate] = useState('');
  const [draftUpdatesByEvent, setDraftUpdatesByEvent] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState('text');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [exportDialog, setExportDialog] = useState({ isOpen: false, title: '', filename: '', scope: 'workspace', sheets: [], selectedKeys: [] });
  const [previewFile, setPreviewFile] = useState(null);
  const [locationPreview, setLocationPreview] = useState(null);
  const [editingUserId, setEditingUserId] = useState('');
  const [profileForm, setProfileForm] = useState({ firstName: '', surname: '', designation: '', email: '', role: '', profilePic: '', theme: 'light' });
  const [managedUserForm, setManagedUserForm] = useState({ firstName: '', surname: '', designation: '', email: '', role: 'user', profilePic: '', isApproved: false });
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', confirmLabel: 'Confirm', tone: 'default' });
  const [noticeDialog, setNoticeDialog] = useState({ isOpen: false, title: '', message: '' });
  const [renameDialog, setRenameDialog] = useState({ isOpen: false, columnKey: '', value: '' });
  const [dateEditor, setDateEditor] = useState({ eventId: '', columnKey: 'date', value: '' });
  const [eventForm, setEventForm] = useState({ ...eventDefaults });
  const [adminMenuColumn, setAdminMenuColumn] = useState(null);
  const [adminMenuPosition, setAdminMenuPosition] = useState({ top: 0, left: 0 });
  const [rightsColumnKey, setRightsColumnKey] = useState('');
  const users = useMemo(() => listedUsers ?? (currentUser ? [currentUser] : []), [listedUsers, currentUser]);
  const customColumns = useMemo(() => (customColumnRecords || []).map((column) => ({ key: column.columnKey, label: column.label, type: column.type, isCustom: true })), [customColumnRecords]);
  const columnLabels = useMemo(() => {
    const defaults = Object.fromEntries(STATIC_COLUMNS.map((column) => [column.key, column.label]));
    return {
      ...defaults,
      ...Object.fromEntries((staticColumnLabelRecords || []).map((record) => [record.columnKey, record.label])),
    };
  }, [staticColumnLabelRecords]);
  const allColumns = useMemo(
    () => orderColumnsAfterPayment([...STATIC_COLUMNS, ...customColumns], columnOrderAfterPaymentDraft.length ? columnOrderAfterPaymentDraft : (currentUser?.columnOrderAfterPayment || [])),
    [columnOrderAfterPaymentDraft, customColumns, currentUser?.columnOrderAfterPayment]
  );
  const columnVisibility = useMemo(() => Object.fromEntries(allColumns.map((column) => [column.key, true])), [allColumns]);
  const permissionsByColumn = useMemo(() => (allColumnPermissions || []).reduce((accumulator, permission) => {
    accumulator[permission.columnKey] = [...(accumulator[permission.columnKey] || []), permission];
    return accumulator;
  }, {}), [allColumnPermissions]);
  const effectiveColumnRights = useMemo(() => Object.fromEntries(allColumns.map((column) => [column.key, currentUser?.role === 'admin' ? { canView: true, canEdit: true } : (currentColumnRights?.[column.key] || { canView: true, canEdit: true })])), [allColumns, currentColumnRights, currentUser]);
  const canManageRows = effectiveColumnRights.name?.canEdit ?? true;
  const canConfigureBoard = ['admin', 'manager'].includes(currentUser?.role || '');
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
  const filtersHydratedRef = useRef(false);
  const collaborationMigratedRef = useRef(false);
  const futureActivityCleanupRef = useRef(false);
  const filesMigratedRef = useRef(false);
  const eventsRef = useRef(events);
  const persistTimeoutsRef = useRef(new Map());
  const eventSyncLocksRef = useRef(new Map());
  const eventFileInputRef = useRef(null);
  const confirmResolverRef = useRef(null);
  const [isFileDropActive, setIsFileDropActive] = useState(false);

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
    return Object.fromEntries(Object.entries(grouped).map(([columnKey, options]) => [columnKey, options.sort((left, right) => left.name.localeCompare(right.name) || left.order - right.order)]));
  }, [customItemColumnKeys, liveLabelOptions]);
  const customItemStyles = useMemo(() => Object.fromEntries(Object.entries(customItemOptionsByColumn).map(([columnKey, options]) => [columnKey, Object.fromEntries(options.map((option) => [option.name, { background: option.color, color: getContrastColor(option.color) }]))])), [customItemOptionsByColumn]);
  const customColumnWidths = useMemo(() => Object.fromEntries(customColumns.map((column) => {
      const headerLength = String(column.label || '').trim().length;
      const optionLength = (customItemOptionsByColumn[column.key] || []).reduce((longest, option) => Math.max(longest, String(option.name || '').trim().length), 0);
      const valueLength = events.reduce((longest, event) => {
        const value = (event.customFields || {})[column.key];
        if (Array.isArray(value)) {
          return Math.max(longest, ...value.map((item) => String(item || '').trim().length), 0);
        }
        return Math.max(longest, String(value || '').trim().length);
      }, 0);
      const longestLength = Math.max(headerLength, optionLength, valueLength, 6);
      const padding = ['singleItem', 'multiItem'].includes(column.type) ? 44 : 30;
      return [column.key, Math.max(120, Math.min(320, longestLength * 9 + padding))];
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
  const attendantStyles = useMemo(() => Object.fromEntries(attendantOptions.map((option) => {
    const branchStyle = branchStyles[option.branchKey];
    return [
      option.fullName,
      branchStyle || { background: '#dfe7f6', color: getContrastColor('#dfe7f6') },
    ];
  })), [attendantOptions, branchStyles]);
  const filteredAttendantOptions = useMemo(() => {
    if (!selectedBranches.length) {
      return attendantOptions;
    }
    return attendantOptions.filter((option) => !option.branchKey || selectedBranches.includes(option.branchKey));
  }, [attendantOptions, selectedBranches]);
  const selectedAttendantEvent = useMemo(() => events.find((event) => event.id === attendantEditorEventId) || null, [attendantEditorEventId, events]);

  const filteredEvents = useMemo(() => {
    return [...events]
      .filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear))
      .filter((event) => {
        if (!search.trim()) {
          return true;
        }
        const query = search.trim().toLowerCase();
        return event.name.toLowerCase().includes(query) || String(event.eventTitle || '').toLowerCase().includes(query);
      })
      .filter((event) => (selectedBranches.length ? event.branch.some((item) => selectedBranches.includes(item)) : true))
        .filter((event) => (selectedProducts.length ? event.products.some((item) => selectedProducts.includes(item)) : true))
        .filter((event) => (selectedStatuses.length ? selectedStatuses.includes(event.status) : true))
        .filter((event) => (selectedPayments.length ? selectedPayments.includes(event.paymentStatus) : true))
        .filter((event) => (selectedAttendants.length ? (event.attendants || []).some((item) => selectedAttendants.includes(item)) : true))
        .sort((left, right) => sortEvents(left, right));
  }, [events, search, selectedAttendants, selectedBranches, selectedPayments, selectedProducts, selectedStatuses, selectedWorkspaceYear]);

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
  const selectedEventBooking = useMemo(() => eventBookingRecord || null, [eventBookingRecord]);
  const commissionMonthEvents = useMemo(() => {
    if (!commissionDialog.isOpen || !commissionDialog.month) {
      return [];
    }
    return events
      .filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear))
      .filter((event) => getEventMonth(event) === commissionDialog.month)
      .filter((event) => Array.isArray(event.attendants) && event.attendants.length > 0)
      .sort((left, right) => sortEvents(left, right));
  }, [commissionDialog.isOpen, commissionDialog.month, events, selectedWorkspaceYear]);
  const commissionAttendantNames = useMemo(
    () => Array.from(new Set(commissionMonthEvents.flatMap((event) => event.attendants || []))).sort((left, right) => left.localeCompare(right)),
    [commissionMonthEvents]
  );
  const commissionRows = useMemo(() => {
    if (!commissionDialog.attendant) {
      return [];
    }
    return commissionMonthEvents
      .filter((event) => (event.attendants || []).includes(commissionDialog.attendant))
      .filter((event) => {
        if (commissionDialog.period === 'all') {
          return true;
        }
        const day = Number(String(event.date || '').split('-')[2] || 0);
        if (!day) {
          return false;
        }
        return commissionDialog.period === 'firstHalf' ? day <= 15 : day >= 16;
      })
      .map((event) => {
        const automaticHoursPayable = parseCommissionHours(event.hours);
        const automaticAmount = calculateCommissionAmount(automaticHoursPayable);
        const override = commissionDialog.overrides[event.id] || {};
        const hoursPayable = override.hoursPayable === '' || override.hoursPayable === undefined
          ? automaticHoursPayable
          : Math.max(0, Number(override.hoursPayable) || 0);
        const amount = override.amount === '' || override.amount === undefined
          ? automaticAmount
          : Math.max(0, Number(override.amount) || 0);
        return {
          id: event.id,
          eventName: event.eventTitle || event.name || 'Untitled event',
          date: event.date,
          hours: event.hours || '0',
          hoursPayable,
          amount,
        };
      });
  }, [commissionDialog.attendant, commissionDialog.overrides, commissionDialog.period, commissionMonthEvents]);
  const highlightedRowId = dateEditor.eventId || branchEditorEventId || productEditorEventId || statusEditorEventId || managedSingleEditor.eventId || customOptionEditor.eventId || attendantEditorEventId || selectedId || activeRowId;
  const initials = currentUser ? `${currentUser.firstName?.[0] || ''}${currentUser.surname?.[0] || ''}`.toUpperCase() : 'SB';
  const nextWorkspaceYear = workspaceYears.length ? Math.max(...workspaceYears) + 1 : Number(selectedWorkspaceYear || new Date().getFullYear()) + 1;
  const selectedYearCompletedCount = events.filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear) && event.status === 'Event Completed').length;
  const mainNameSuggestions = useMemo(() => Array.from(new Set(events.map((event) => String(event.name || '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)), [events]);
  const hoursSuggestions = useMemo(() => Array.from(new Set(events.map((event) => String(event.hours || '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)), [events]);
  const orderedMonths = monthOrder.length === monthNames.length ? monthOrder : monthNames;
  const displayColumnLabel = (column) => column.isCustom ? column.label : (columnLabels[column.key] || column.label);
  const buildDefaultCustomFields = () => Object.fromEntries(customColumns.map((column) => [column.key, column.type === 'multiItem' ? [] : '']));
  const getRenderedColumnWidth = (column) => column.isCustom ? Math.max(84, customColumnWidths[column.key] || 0) : getColumnWidth(column);
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

  const openNotice = (message, title = 'Notice') => {
    setNoticeDialog({ isOpen: true, title, message });
  };

  const closeNotice = () => {
    setNoticeDialog({ isOpen: false, title: '', message: '' });
  };

  const buildBookingLinkUrl = (token) => {
    if (!token || typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/${token}`;
  };

  const copyBookingLink = async (token) => {
    const url = buildBookingLinkUrl(token);
    if (!url) {
      openNotice('Generate the booking link first.');
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      openNotice('Booking link copied to clipboard.');
    } catch (error) {
      console.error('Failed to copy booking link', error);
      openNotice('The booking link could not be copied right now.');
    }
  };

  const openBookingLink = (token) => {
    const url = buildBookingLinkUrl(token);
    if (!url) {
      openNotice('Generate the booking link first.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const generateBookingLink = async () => {
    if (!selectedEvent) {
      return;
    }

    try {
      const result = await generateBookingLinkMutation({ eventKey: selectedEvent.id });
      if (result?.token) {
        setDrawerTab('booking');
        openNotice('Booking link is ready for this event.');
      } else {
        openNotice('The booking link could not be generated.');
      }
    } catch (error) {
      console.error('Failed to generate booking link', error);
      openNotice(error?.message || 'The booking link could not be generated.');
    }
  };

  const closeRenameDialog = () => {
    setRenameDialog({ isOpen: false, columnKey: '', value: '' });
  };

  useEffect(() => {
    if (!selectedId) {
      setDraftUpdate('');
      return;
    }
    setDraftUpdate(draftUpdatesByEvent[selectedId] || '');
  }, [draftUpdatesByEvent, selectedId]);

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
    try {
      await updateStaticColumnLabelMutation({ columnKey: renameDialog.columnKey, label: trimmedLabel });
    } catch (error) {
      console.error('Failed to rename static column', error);
      window.alert('The column name could not be saved. Please try again.');
      return;
    }
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
        theme: currentUser.theme === 'dark' ? 'dark' : 'light',
      });
    }
  }, [showProfileModal, currentUser]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const theme = currentUser?.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [currentUser?.theme]);

  useEffect(() => {
    if (!clerkUser) {
      userSyncKeyRef.current = '';
      return;
    }

    const email = clerkUser.primaryEmailAddress?.emailAddress || '';
    if (!email) {
      return;
    }

    let pendingRegistration = null;
    try {
      const stored = window.sessionStorage.getItem(PENDING_REGISTRATION_KEY);
      pendingRegistration = stored ? JSON.parse(stored) : null;
    } catch {
      pendingRegistration = null;
    }

    const normalizedPendingEmail = String(pendingRegistration?.email || '').trim().toLowerCase();
    const matchesPendingRegistration = !normalizedPendingEmail || normalizedPendingEmail === email.trim().toLowerCase();
    const pendingFirstName = matchesPendingRegistration ? String(pendingRegistration?.firstName || '').trim() : '';
    const pendingSurname = matchesPendingRegistration ? String(pendingRegistration?.surname || '').trim() : '';
    const pendingDesignation = matchesPendingRegistration ? String(pendingRegistration?.designation || '').trim() : '';

    if (matchesPendingRegistration && (pendingFirstName || pendingSurname || pendingDesignation)) {
      void clerkUser.update({
        firstName: clerkUser.firstName || pendingFirstName || undefined,
        lastName: clerkUser.lastName || pendingSurname || undefined,
        unsafeMetadata: {
          ...(clerkUser.unsafeMetadata || {}),
          ...(pendingDesignation ? { designation: pendingDesignation } : {}),
        },
      }).catch((error) => {
        console.error('Failed to sync pending Clerk profile fields', error);
      });
    }

    if (currentUser) {
      userSyncKeyRef.current = clerkUser.id;
      if (matchesPendingRegistration) {
        window.sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
      }
      return;
    }

    if (userSyncKeyRef.current === clerkUser.id) {
      return;
    }

    userSyncKeyRef.current = clerkUser.id;
    void syncCurrentUser({
        email,
        firstName: clerkUser.firstName || pendingFirstName || 'New',
        surname: clerkUser.lastName || pendingSurname || 'User',
        designation: String(clerkUser.unsafeMetadata?.designation || pendingDesignation || ''),
        profilePic: clerkUser.imageUrl || '',
        theme: 'light',
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
    if (!canAccessDashboard || liveLabelOptions === undefined || labelsSeededRef.current) {
      return;
    }

    const hasAccountOptions = liveLabelOptions.some((option) => option.columnKey === 'accounts');
    if (liveLabelOptions.length && hasAccountOptions) {
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
    const sortByNameThenOrder = (left, right) => left.name.localeCompare(right.name) || sortByOrder(left, right);

    const branch = (byColumn.branch || []).slice().sort(sortByNameThenOrder).map((option) => ({ abbreviation: option.abbreviation || option.optionKey, fullName: option.name, color: option.color }));
    const products = (byColumn.products || []).slice().sort(sortByNameThenOrder).map((option) => ({ optionKey: option.optionKey, abbreviation: option.abbreviation || abbreviateLabel(option.name || option.optionKey), fullName: sanitizeProductLabel(option.name), color: option.color }));
    const status = (byColumn.status || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color }));
    const attendants = (byColumn.attendants || []).slice().sort(sortByNameThenOrder).map((option) => ({ fullName: option.name, branchKey: option.branchKey || '' }));

    if (branch.length) setBranchOptions(branch);
    if (products.length) setProductOptions(products);
    if (status.length) setStatusOptions(status);
    if (attendants.length) setAttendantOptions(attendants);

    setManagedSingleOptions((current) => ({
      paymentStatus: (byColumn.paymentStatus || []).length ? (byColumn.paymentStatus || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color })) : current.paymentStatus,
      accounts: (byColumn.accounts || []).length ? (byColumn.accounts || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color })) : current.accounts,
      vinyl: (byColumn.vinyl || []).length ? (byColumn.vinyl || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color })) : current.vinyl,
      gsAi: (byColumn.gsAi || []).length ? (byColumn.gsAi || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color })) : current.gsAi,
      imagesSent: (byColumn.imagesSent || []).length ? (byColumn.imagesSent || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color })) : current.imagesSent,
      snappic: (byColumn.snappic || []).length ? (byColumn.snappic || []).slice().sort(sortByNameThenOrder).map((option) => ({ name: option.name, color: option.color })) : current.snappic,
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

  const persistLabelOption = (columnKey, optionKey, name, abbreviation, color, order, branchKey = '') => {
    void upsertLabelOptionMutation({ columnKey, optionKey, name, abbreviation: abbreviation || '', color, order, branchKey }).catch((error) => {
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
    setDraftUpdate(draftUpdatesByEvent[eventId] || '');
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedId('');
  };
  const saveQuickUpdate = async () => {
    if (!selectedEvent || !draftUpdate.trim()) {
      return;
    }

    const nextBody = draftUpdate.trim();
    setDraftUpdate('');
    setDraftUpdatesByEvent((current) => ({ ...current, [selectedEvent.id]: '' }));

    try {
      await addEventUpdateMutation({ eventKey: selectedEvent.id, body: nextBody });
    } catch (error) {
      console.error('Failed to save update', error);
      setDraftUpdate(nextBody);
      setDraftUpdatesByEvent((current) => ({ ...current, [selectedEvent.id]: nextBody }));
    }
  };

  const openEventFilePicker = () => {
    eventFileInputRef.current?.click();
  };

  const uploadEventFile = async (file) => {
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
      if ((file.type || '').toLowerCase().includes('pdf') || /\.pdf$/i.test(file.name)) {
        void extractUploadedDocumentNumber({
          eventKey: selectedEvent.id,
          storageId,
          name: file.name,
          contentType: file.type || '',
        }).catch((error) => {
          console.error('Failed to extract document number', error);
        });
      }
    } catch (error) {
      console.error('Failed to upload file', error);
      window.alert('The file could not be uploaded. Please try again.');
    }
  };

  const handleEventFileSelection = async (changeEvent) => {
    const file = changeEvent.target.files?.[0];
    try {
      await uploadEventFile(file);
    } finally {
      changeEvent.target.value = '';
    }
  };

  const handleFileDrop = async (dropEvent) => {
    dropEvent.preventDefault();
    setIsFileDropActive(false);
    const file = dropEvent.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    await uploadEventFile(file);
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

  const shareLocationPreview = async () => {
    if (!locationPreview) {
      return;
    }
    const url = buildGoogleMapsExternalUrl(locationPreview);
    const shareData = {
      title: locationPreview.title || 'Location',
      text: locationPreview.address || locationPreview.title || 'Location',
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        openNotice('Google Maps link copied to clipboard.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Failed to share location preview', error);
        openNotice('Unable to share this location right now.');
      }
    }
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
    const eventRecord = eventsRef.current.find((event) => event.id === eventId);
    if (eventRecord && isPastEvent(eventRecord) && currentUser?.role !== 'admin') {
      openNotice('Only admins can delete past events.');
      return;
    }
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
    clearFilters({ includeSearch: true });
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
    const fallbackDraftMonth =
      eventForm.draftMonth ||
      orderedMonths.find((month) => !collapsedMonths[month]) ||
      monthNames[new Date().getMonth()];
    const newEvent = {
      ...eventDefaults,
      id: `evt-${String(events.length + 1).padStart(3, '0')}`,
      name: eventForm.name,
      eventTitle: eventForm.eventTitle || '',
      date: eventForm.date,
      draftMonth: eventForm.date ? monthNames[new Date(eventForm.date).getMonth()] : fallbackDraftMonth,
      workspaceYear: eventForm.date ? new Date(eventForm.date).getFullYear() : selectedWorkspaceYear,
      hours: eventForm.hours,
      branch: [...(eventForm.branch || [])],
      products: [...(eventForm.products || [])],
      status: eventForm.status,
      location: eventForm.location,
      locationPlaceId: eventForm.locationPlaceId || '',
      locationLat: typeof eventForm.locationLat === 'number' ? eventForm.locationLat : null,
      locationLng: typeof eventForm.locationLng === 'number' ? eventForm.locationLng : null,
      paymentStatus: eventForm.paymentStatus,
      accounts: eventForm.accounts,
      quoteNumber: eventForm.quoteNumber || '',
      invoiceNumber: eventForm.invoiceNumber || '',
      exVatAuto: eventForm.exVatAuto || '',
      vinyl: eventForm.vinyl,
      gsAi: eventForm.gsAi,
      imagesSent: eventForm.imagesSent,
      snappic: eventForm.snappic,
      attendants: [...(eventForm.attendants || [])],
      exVat: eventForm.exVat,
      packageOnly: eventForm.packageOnly,
      notes: eventForm.notes || '',
      customFields: buildDefaultCustomFields(),
      updates: [],
      files: [],
      activity: [],
    };
    replaceEvents((current) => [newEvent, ...current]);
    queueActivityLog({
      workspaceYear: newEvent.workspaceYear || selectedWorkspaceYear,
      eventKey: newEvent.id,
      eventName: newEvent.name || 'Untitled event',
      text: 'Created event.',
    }, 500);
    clearFilters({ includeSearch: true });
    setCollapsedMonths((current) => ({
      ...current,
      [newEvent.draftMonth || monthNames[new Date().getMonth()]]: false,
    }));
    setShowAddModal(false);
    setEventForm({ ...eventDefaults });
    openDrawer(newEvent.id);
  };

  const handleCreateWorkspace = async (submitEvent) => {
    submitEvent?.preventDefault?.();
    if (!currentUser || !['admin', 'manager'].includes(currentUser.role)) {
      return;
    }
    const createdWorkspace = await createNextWorkspaceYear({});
    setSelectedWorkspaceYear(createdWorkspace.year);
    setShowWorkspaceModal(false);
  };

  const openExportDialog = ({ scope, month = '', monthItems = [] }) => {
    if (!currentUser || (scope === 'workspace' && currentUser.role !== 'admin')) {
      return;
    }

    const sheets = scope === 'month'
      ? [{ name: month, events: monthItems }]
      : monthNames
          .map((monthName) => ({ name: monthName, events: eventsByMonth[monthName] || [] }))
          .filter((sheet) => sheet.events.length > 0);

    setExportDialog({
      isOpen: true,
      title: scope === 'month' ? `Export ${month}` : `Export ${selectedWorkspaceYear}`,
      filename: scope === 'month'
        ? `selfiebox-events-${selectedWorkspaceYear}-${month.toLowerCase()}.xlsx`
        : `selfiebox-events-${selectedWorkspaceYear}.xlsx`,
      scope,
      sheets,
      selectedKeys: visibleColumns.map((column) => column.key),
    });
  };

  const toggleExportColumn = (columnKey) => {
    setExportDialog((current) => ({
      ...current,
      selectedKeys: current.selectedKeys.includes(columnKey)
        ? current.selectedKeys.filter((key) => key !== columnKey)
        : [...current.selectedKeys, columnKey],
    }));
  };

  const runExport = async () => {
    if (!exportDialog.selectedKeys.length) {
      openNotice('Please select at least one column to export.');
      return;
    }

    const exportColumns = visibleColumns.filter((column) => exportDialog.selectedKeys.includes(column.key));
    const workbookBuffer = await buildWorkbookXlsxBuffer({
      sheets: exportDialog.sheets.map((sheet) => ({
        name: sheet.name,
        rows: sheet.events.map((event) => exportColumns.map((column) => buildExportCell(column, event, {
          branchFullNames,
          productFullNames,
          branchStyles,
          productStyles,
          statusStyles,
          managedSingleStyles,
          attendantStyles,
          customItemStyles,
        }))),
      })),
      columns: exportColumns.map((column) => ({
        key: column.key,
        label: displayColumnLabel(column),
        width: getRenderedColumnWidth(column),
      })),
    });

    downloadWorkbookFile(exportDialog.filename, workbookBuffer);
    setExportDialog({ isOpen: false, title: '', filename: '', scope: 'workspace', sheets: [], selectedKeys: [] });
  };

  const exportWorkspaceToExcel = () => {
      if (!currentUser || currentUser.role !== 'admin') {
        return;
      }
      openExportDialog({ scope: 'workspace' });
    };

  const exportMonthToExcel = (month, monthItems) => {
      if (!currentUser || !canAccessDashboard) {
        return;
      }
      openExportDialog({ scope: 'month', month, monthItems });
    };

  const openCommissionDialog = (month) => {
    if (!currentUser || currentUser.role !== 'admin') {
      return;
    }
    const monthEvents = events
      .filter((event) => (event.date ? new Date(event.date).getFullYear() === selectedWorkspaceYear : event.workspaceYear === selectedWorkspaceYear))
      .filter((event) => getEventMonth(event) === month);
    const attendantsForMonth = Array.from(new Set(monthEvents.flatMap((event) => event.attendants || []))).sort((left, right) => left.localeCompare(right));
    setCommissionDialog({
      isOpen: true,
      month,
      attendant: attendantsForMonth[0] || '',
      period: 'all',
      overrides: {},
    });
  };

  const closeCommissionDialog = () => {
    setCommissionDialog({
      isOpen: false,
      month: '',
      attendant: '',
      period: 'all',
      overrides: {},
    });
  };

  const updateCommissionOverride = (eventId, field, value) => {
    setCommissionDialog((current) => ({
      ...current,
      overrides: {
        ...current.overrides,
        [eventId]: {
          ...(current.overrides[eventId] || {}),
          [field]: value,
        },
      },
    }));
  };

  const exportCommissionSheet = async () => {
    if (!commissionDialog.month || !commissionDialog.attendant) {
      openNotice('Please choose an attendant first.');
      return;
    }
    if (!commissionRows.length) {
      openNotice('There are no commission line items for this selection.');
      return;
    }
    try {
      await exportCommissionPdf({
        month: commissionDialog.month,
        year: selectedWorkspaceYear,
        period: commissionDialog.period,
        attendant: commissionDialog.attendant,
        rows: commissionRows,
      });
    } catch (error) {
      console.error('Failed to export commission PDF', error);
      openNotice('The commission PDF could not be created. Please try again.');
    }
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

    const nextFirstName = profileForm.firstName.trim() || currentUser.firstName;
    const nextSurname = profileForm.surname.trim() || currentUser.surname;
    const nextDesignation = profileForm.designation.trim() || currentUser.designation;

    if (clerkUser) {
      await clerkUser.update({
        firstName: nextFirstName,
        lastName: nextSurname,
        unsafeMetadata: {
          ...(clerkUser.unsafeMetadata || {}),
          designation: nextDesignation,
        },
      });
    }

    await updateMyProfile({
      firstName: nextFirstName,
      surname: nextSurname,
      designation: nextDesignation,
      profilePic: profileForm.profilePic || '',
      theme: profileForm.theme === 'dark' ? 'dark' : 'light',
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
  const saveMonthOrder = async (nextOrder) => {
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
  const startMonthDrag = (month) => {
    setDraggedMonth(month);
    setDragOverMonth('');
  };
  const handleMonthDragOver = (event, month) => {
    event.preventDefault();
    if (!draggedMonth || draggedMonth === month) {
      return;
    }
    setDragOverMonth(month);
  };
  const handleMonthDrop = async (targetMonth) => {
    if (!draggedMonth || draggedMonth === targetMonth) {
      setDraggedMonth('');
      setDragOverMonth('');
      return;
    }
    const currentIndex = monthOrder.indexOf(draggedMonth);
    const targetIndex = monthOrder.indexOf(targetMonth);
    if (currentIndex === -1 || targetIndex === -1) {
      setDraggedMonth('');
      setDragOverMonth('');
      return;
    }
    const nextOrder = [...monthOrder];
    const [movedMonth] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(targetIndex, 0, movedMonth);
    setDraggedMonth('');
    setDragOverMonth('');
    await saveMonthOrder(nextOrder);
  };
  const endMonthDrag = () => {
    setDraggedMonth('');
    setDragOverMonth('');
  };
  const saveColumnOrderAfterPayment = async (nextOrder, fallbackOrder) => {
    setColumnOrderAfterPaymentDraft(nextOrder);
    try {
      await updateColumnOrderAfterPaymentMutation({ columnOrderAfterPayment: nextOrder });
    } catch (error) {
      console.error('Failed to save column order', error);
      setColumnOrderAfterPaymentDraft(fallbackOrder || currentUser?.columnOrderAfterPayment || []);
      window.alert('The column order could not be saved. Please try again.');
    }
  };

  const startColumnDrag = (columnKey) => {
    setDraggedColumnKey(columnKey);
    setDragOverColumnKey(columnKey);
  };

  const handleColumnDragOver = (event, columnKey) => {
    event.preventDefault();
    if (!draggedColumnKey || draggedColumnKey === columnKey) {
      return;
    }
    setDragOverColumnKey(columnKey);
  };

  const handleColumnDrop = async (targetColumnKey) => {
    if (!draggedColumnKey || draggedColumnKey === targetColumnKey) {
      setDraggedColumnKey('');
      setDragOverColumnKey('');
      return;
    }

  const paymentIndex = allColumns.findIndex((column) => column.key === 'accounts');
  const movable = paymentIndex === -1 ? [] : allColumns.slice(paymentIndex + 1).map((column) => column.key);
    const sourceIndex = movable.indexOf(draggedColumnKey);
    const targetIndex = movable.indexOf(targetColumnKey);

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedColumnKey('');
      setDragOverColumnKey('');
      return;
    }

    const nextOrder = [...movable];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);

    setDraggedColumnKey('');
    setDragOverColumnKey('');
    await saveColumnOrderAfterPayment(nextOrder, movable);
  };

  const endColumnDrag = () => {
    setDraggedColumnKey('');
    setDragOverColumnKey('');
  };
  const renameColumn = (columnKey) => {
    if (!canConfigureBoard) {
      return;
    }
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
    if (!canConfigureBoard) {
      return;
    }
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

  const clearFilters = ({ includeSearch = false } = {}) => {
    setSelectedBranches([]);
    setSelectedProducts([]);
    setSelectedStatuses([]);
    setSelectedPayments([]);
    setSelectedAttendants([]);
    if (includeSearch) {
      setSearch('');
    }
  };
  const activeFilterCount =
    selectedBranches.length +
    selectedProducts.length +
    selectedStatuses.length +
    selectedPayments.length +
    selectedAttendants.length;
  const hasActiveFilters = activeFilterCount > 0;
  const activeSavedFilterViewId = useMemo(() => {
    const sameValues = (left = [], right = []) =>
      left.length === right.length && left.every((value, index) => value === right[index]);
    const match = savedFilterViews.find(
      (view) =>
        sameValues(view.branches || [], selectedBranches) &&
        sameValues(view.products || [], selectedProducts) &&
        sameValues(view.statuses || [], selectedStatuses) &&
        sameValues(view.payments || [], selectedPayments) &&
        sameValues(view.attendants || [], selectedAttendants)
      );
      return match?.id || '';
  }, [savedFilterViews, selectedAttendants, selectedBranches, selectedProducts, selectedStatuses, selectedPayments]);

  const openSaveCustomViewModal = () => {
    if (savedFilterViews.length >= 8) {
      openNotice('You can save up to 8 custom views.');
      return;
    }
    setNewFilterViewName('');
    setSaveFilterViewModalOpen(true);
  };

  const saveCustomFilterView = () => {
    const name = newFilterViewName.trim();
    if (!name) {
      openNotice('Please enter a custom view name.');
      return;
    }
    if (savedFilterViews.some((view) => view.name.toLowerCase() === name.toLowerCase())) {
      openNotice('That custom view name already exists.');
      return;
    }
    setSavedFilterViews((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.slice(0, 15),
      branches: [...selectedBranches],
      products: [...selectedProducts],
      statuses: [...selectedStatuses],
      payments: [...selectedPayments],
      attendants: [...selectedAttendants],
    }].slice(0, 8));
    setSaveFilterViewModalOpen(false);
    setNewFilterViewName('');
  };

  const applySavedFilterView = (view) => {
    setSelectedBranches([...(view.branches || [])]);
    setSelectedProducts([...(view.products || [])]);
    setSelectedStatuses([...(view.statuses || [])]);
    setSelectedPayments([...(view.payments || [])]);
    setSelectedAttendants([...(view.attendants || [])]);
  };

  const deleteSavedFilterView = (viewId) => {
    setSavedFilterViews((current) => current.filter((view) => view.id !== viewId));
  };

  const requestDeleteSavedFilterView = async (view) => {
    const confirmed = await requestConfirmation({
      title: 'Delete custom view',
      message: `Delete "${view.name}" permanently?`,
      confirmLabel: 'Delete',
      tone: 'danger'
    });
    if (confirmed) {
      deleteSavedFilterView(view.id);
    }
  };


  const openBranchManager = () => {
    setAdminMenuColumn(null);
    setBranchDrafts(Object.fromEntries(branchOptions.map((option) => [option.abbreviation, { abbreviation: option.abbreviation, fullName: option.fullName, color: option.color }])));
    setBranchManagerOpen(true);
  };

  const addBranchOption = () => {
    const fullName = newBranchFullName.trim();
    const abbreviation = newBranchAbbreviation.trim().toUpperCase();
    if (!fullName || !abbreviation || abbreviation.length > 7) {
      return;
    }
    if (branchOptions.some((option) => option.abbreviation.toLowerCase() === abbreviation.toLowerCase())) {
      openNotice('That abbreviation already exists.');
      return;
    }
    if (branchOptions.some((option) => option.fullName.toLowerCase() === fullName.toLowerCase())) {
      openNotice('That branch name already exists.');
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
        [key]: key === 'abbreviation' ? value.toUpperCase().slice(0, 7) : value,
      },
    }));
  };

  const saveBranchOption = (branchKey) => {
    const draft = branchDrafts[branchKey];
    const nextFullName = draft?.fullName?.trim();
    const nextAbbreviation = draft?.abbreviation?.trim().toUpperCase();
    const nextColor = draft?.color || '#b8d9ff';
    if (!nextFullName || !nextAbbreviation || nextAbbreviation.length > 7) {
      openNotice('Please enter a full name and an abbreviation of 7 characters or less.');
      return;
    }
    const duplicateAbbreviation = branchOptions.some((option) => option.abbreviation !== branchKey && option.abbreviation.toLowerCase() === nextAbbreviation.toLowerCase());
    if (duplicateAbbreviation) {
      openNotice('That abbreviation already exists.');
      return;
    }
    const duplicateBranchName = branchOptions.some((option) => option.abbreviation !== branchKey && option.fullName.toLowerCase() === nextFullName.toLowerCase());
    if (duplicateBranchName) {
      openNotice('That branch name already exists.');
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
    if (!fullName || !abbreviation || abbreviation.length > 7) {
      return;
    }
    if (productOptions.some((option) => option.abbreviation === abbreviation)) {
      openNotice('A product with that abbreviation already exists. Please change it slightly.');
      return;
    }
    if (productOptions.some((option) => option.fullName.toLowerCase() === fullName.toLowerCase())) {
      openNotice('That product name already exists.');
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
        [key]: key === 'abbreviation' ? value.toUpperCase().slice(0, 7) : value,
      },
    }));
  };

  const saveProductOption = (productKey) => {
    const draft = productDrafts[productKey];
    const nextFullName = draft?.fullName?.trim();
    const nextColor = draft?.color || '#d9edf8';
    const nextAbbreviation = draft?.abbreviation?.trim().toUpperCase();
    const existingOption = productOptions.find((option) => (option.optionKey || option.abbreviation) === productKey);
    const draftKeyAfterSave = existingOption?.optionKey || nextAbbreviation;
    const previousStoredValue = existingOption?.abbreviation || productKey;
    if (!nextFullName || !nextAbbreviation || nextAbbreviation.length > 7) {
      openNotice('Please enter a full name and an abbreviation of 7 characters or less.');
      return;
    }
    const duplicateAbbreviation = productOptions.some((option) => (option.optionKey || option.abbreviation) !== productKey && option.abbreviation === nextAbbreviation);
    if (duplicateAbbreviation) {
      openNotice('Another product already uses that abbreviation.');
      return;
    }
    const duplicateProductName = productOptions.some((option) => (option.optionKey || option.abbreviation) !== productKey && option.fullName.toLowerCase() === nextFullName.toLowerCase());
    if (duplicateProductName) {
      openNotice('That product name already exists.');
      return;
    }
    persistLabelOption('products', productKey, nextFullName, nextAbbreviation, nextColor, productOptions.findIndex((option) => (option.optionKey || option.abbreviation) === productKey));
      setProductOptions((current) => current.map((option) => ((option.optionKey || option.abbreviation) === productKey ? { ...option, abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor } : option)));
    if (nextAbbreviation !== previousStoredValue) {
      replaceEvents((current) => current.map((event) => ({
        ...event,
        products: Array.from(new Set(event.products.map((item) => (item === previousStoredValue ? nextAbbreviation : item)))),
      })));
      setSelectedProducts((current) => current.map((item) => (item === previousStoredValue ? nextAbbreviation : item)));
      setEventForm((current) => ({
        ...current,
        products: current.products.map((item) => (item === previousStoredValue ? nextAbbreviation : item)),
      }));
    }
    setProductDrafts((current) => {
      const nextDrafts = { ...current };
      if (draftKeyAfterSave !== productKey) {
        delete nextDrafts[productKey];
      }
      nextDrafts[draftKeyAfterSave] = { abbreviation: nextAbbreviation, fullName: nextFullName, color: nextColor };
      return nextDrafts;
    });
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
    setNewManagedOptionColor(['paymentStatus', 'accounts'].includes(columnKey) ? '#2b61d1' : '#d93c56');
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
    setNewAttendantBranch('');
    setAttendantDrafts(Object.fromEntries(attendantOptions.map((option) => [option.fullName, { fullName: option.fullName, branchKey: option.branchKey || '' }])));
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
    const branchStyle = branchStyles[newAttendantBranch];
    const newOption = { fullName, branchKey: newAttendantBranch || '' };
    persistLabelOption('attendants', fullName, fullName, '', branchStyle?.background || '#dfe7f6', attendantOptions.length, newAttendantBranch || '');
    setAttendantOptions((current) => [...current, newOption]);
    setAttendantDrafts((current) => ({ ...current, [fullName]: newOption }));
    setNewAttendantName('');
    setNewAttendantBranch('');
  };

  const updateAttendantDraft = (attendantKey, key, value) => {
    setAttendantDrafts((current) => ({
      ...current,
      [attendantKey]: {
        ...((current[attendantKey]) || { fullName: attendantKey, branchKey: '' }),
        [key]: key === 'fullName' ? value.slice(0, 100) : value,
      },
    }));
  };

  const saveAttendantOption = (attendantKey) => {
    const draft = attendantDrafts[attendantKey];
    const nextName = draft?.fullName?.trim();
    const nextBranchKey = draft?.branchKey || '';
    if (!nextName || nextName.length > 100) {
      window.alert('Please enter a name of 100 characters or less.');
      return;
    }
    if (attendantOptions.some((option) => option.fullName !== attendantKey && option.fullName.toLowerCase() === nextName.toLowerCase())) {
      window.alert('That attendant already exists.');
      return;
    }
    const branchStyle = branchStyles[nextBranchKey];
    persistLabelOption('attendants', nextName, nextName, '', branchStyle?.background || '#dfe7f6', attendantOptions.findIndex((option) => option.fullName === attendantKey), nextBranchKey);
      if (nextName !== attendantKey) {
        removeLabelOption('attendants', attendantKey);
      }
      setAttendantOptions((current) => current.map((option) => (option.fullName === attendantKey ? { fullName: nextName, branchKey: nextBranchKey } : option)));
    if (nextName !== attendantKey) {
      replaceEvents((current) => current.map((event) => ({ ...event, attendants: (event.attendants || []).map((item) => item === attendantKey ? nextName : item) })));
      setEventForm((current) => ({ ...current, attendants: (current.attendants || []).map((item) => item === attendantKey ? nextName : item) }));
      setAttendantDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[attendantKey];
        nextDrafts[nextName] = { fullName: nextName, branchKey: nextBranchKey };
        return nextDrafts;
      });
      return;
    }
    setAttendantDrafts((current) => ({ ...current, [attendantKey]: { fullName: nextName, branchKey: nextBranchKey } }));
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
              {['admin', 'manager'].includes(currentUser.role) ? <button className="workspace-text-button" type="button" onClick={() => setShowWorkspaceModal(true)}>Add Year</button> : null}
              {currentUser.role === 'admin' ? <button className="workspace-text-button" type="button" onClick={exportWorkspaceToExcel}>Export to Excel</button> : null}
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
            <button
              className={[
                "ghost-button",
                "filter-button",
                "filter-open-button",
                hasActiveFilters ? "is-active" : ""
              ].join(" ").trim()}
              type="button"
              onClick={() => {
                if (hasActiveFilters) {
    clearFilters({ includeSearch: true });
                  return;
                }
                setFiltersOpen(true);
              }}
            >
              Filter
              {hasActiveFilters ? <span className="filter-active-badge" aria-hidden="true">Clear</span> : null}
            </button>
            {savedFilterViews.length ? (
              <div className="saved-filter-chip-stack">
                <div className="saved-filter-chip-label">Saved Filters</div>
                <div className="saved-filter-chip-row">
                  {savedFilterViews.map((view) => (
                    <div
                      className={["saved-filter-chip", activeSavedFilterViewId === view.id ? "is-active" : ""].join(" ").trim()}
                      key={view.id}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void requestDeleteSavedFilterView(view);
                      }}
                      title="Right-click to delete"
                    >
                      <button className="saved-filter-chip-button" type="button" onClick={() => applySavedFilterView(view)}>{view.name}</button>
                      <button className="saved-filter-chip-close" type="button" aria-label="Clear filters" onClick={clearFilters}>x</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <button className="workspace-text-button board-activities-link" type="button" onClick={() => setActivitiesOpen(true)}>Activities</button>
        </div>
        <div className="board-surface" ref={boardSurfaceRef} style={{ '--board-columns': boardColumnTemplate, '--board-width': `${boardWidth}px` }}>
          <div className="board-row board-header" style={{ gridTemplateColumns: boardColumnTemplate, width: `${boardWidth}px` }} onClick={() => setAdminMenuColumn(null)}>
            {visibleColumns.map((column) => (
            <div className={`cell cell-${column.key} ${draggedColumnKey === column.key ? 'is-dragging-column' : ''} ${dragOverColumnKey === column.key ? 'is-drag-target' : ''}`} key={column.key} draggable={allColumns.findIndex((entry) => entry.key === column.key) > allColumns.findIndex((entry) => entry.key === 'accounts')} style={column.isCustom && column.type === 'singleItem' ? { width: `${getRenderedColumnWidth(column)}px`, minWidth: `${getRenderedColumnWidth(column)}px` } : undefined} onDragStart={() => startColumnDrag(column.key)} onDragOver={(event) => handleColumnDragOver(event, column.key)} onDrop={() => void handleColumnDrop(column.key)} onDragEnd={endColumnDrag} onContextMenu={(event) => {
                if (!canConfigureBoard) return;
                event.preventDefault();
                setAdminMenuColumn(column.key);
                setAdminMenuPosition({ top: event.clientY + 4, left: event.clientX + 4 });
              }}>
                <div className="column-header-label">{displayColumnLabel(column)}</div>
              {adminMenuColumn === column.key ? <div className="admin-menu" style={{ top: adminMenuPosition.top, left: adminMenuPosition.left }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => renameColumn(column.key)}>Rename header</button>{currentUser.role === 'admin' ? <button type="button" onClick={() => openRightsManager(column.key)}>Manage rights</button> : null}{column.key === 'branch' ? <button type="button" onClick={openBranchManager}>Add/Edit item</button> : null}{column.key === 'products' ? <button type="button" onClick={openProductManager}>Add/Edit item</button> : null}{column.key === 'status' ? <button type="button" onClick={openStatusManager}>Add/Edit item</button> : null}{['paymentStatus', 'accounts', 'vinyl', 'gsAi', 'imagesSent', 'snappic'].includes(column.key) ? <button type="button" onClick={() => openManagedSingleManager(column.key)}>Add/Edit item</button> : null}{column.key === 'attendants' ? <button type="button" onClick={openAttendantManager}>Add/Edit item</button> : null}{customColumns.some((customColumn) => customColumn.key === column.key && ['singleItem', 'multiItem'].includes(customColumn.type)) ? <button type="button" onClick={() => openCustomOptionManager(column.key)}>Add/Edit item</button> : null}{column.isCustom && currentUser.role === 'admin' ? <button type="button" onClick={() => deleteCustomColumn(column.key)}>Delete column</button> : null}</div> : null}
              </div>
            ))}
            {canConfigureBoard ? <button className="cell cell-actions add-column-trigger" type="button" onClick={() => setShowAddColumnModal(true)}>+</button> : <div className="cell cell-actions" />}
          </div>

          {orderedMonths.map((month) => {
            const monthItems = eventsByMonth[month] || [];
            const totalsByColumn = visibleColumns.reduce((accumulator, column) => {
              if (column.type !== 'number') {
                return accumulator;
              }

              const total = monthItems.reduce((sum, event) => {
                const rawValue = column.isCustom ? (event.customFields || {})[column.key] : event[column.key];
                return sum + parseNumericCellValue(rawValue);
              }, 0);

              accumulator[column.key] = total;
              return accumulator;
            }, {});
            const upcomingCount = monthItems.filter((event) => event.status === 'In Progress').length;
            const completedCount = monthItems.filter((event) => event.status === 'Event Completed').length;
              const fullyPaidCount = monthItems.filter((event) => event.accounts === '100%').length;
            return (
              <section className={`month-section ${monthAccentClass[month]} ${draggedMonth === month ? 'is-dragging-month' : ''} ${dragOverMonth === month ? 'is-drag-target-month' : ''}`} key={month} style={{ minWidth: `${boardWidth}px` }}>
                <button className="month-header" type="button" draggable style={{ minWidth: `${boardWidth}px` }} onDragStart={() => startMonthDrag(month)} onDragOver={(event) => handleMonthDragOver(event, month)} onDrop={() => void handleMonthDrop(month)} onDragEnd={endMonthDrag} onClick={() => toggleMonth(month)}>
                  <div className="month-header-main"><strong>{month} {selectedWorkspaceYear}</strong><span>{monthItems.length} events</span><span>{upcomingCount} Upcoming Events</span><span>{completedCount} Completed Events</span><span>{fullyPaidCount} Fully Paid</span></div>
                  <div className="month-header-actions">{currentUser.role === 'admin' ? <button className="month-export-button month-commission-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openCommissionDialog(month); }}>Commission</button> : null}<button className="month-export-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); exportMonthToExcel(month, monthItems); }}>Export to Excel</button><span className="month-toggle">{collapsedMonths[month] ? '+' : '-'}</span></div>
                </button>
                {!collapsedMonths[month] ? (
                  <>
{monthItems.length > 0 ? monthItems.map((event) => <div key={event.id} ref={(node) => setEventRowRef(event.id, node)} className={["board-row", "board-entry", getEventDayShadeClass(event), highlightedRowId === event.id ? "is-active" : ""].join(" ").trim()} style={{ gridTemplateColumns: boardColumnTemplate, width: `${boardWidth}px` }}>{visibleColumns.map((column) => <div className={`cell cell-${column.key}`} key={column.key} style={column.isCustom && column.type === 'singleItem' ? { width: `${getRenderedColumnWidth(column)}px`, minWidth: `${getRenderedColumnWidth(column)}px` } : undefined}>{renderCell({ columnKey: column.key, event, openDrawer, updateEventField, updateEventLocationText, applyEventLocation, updateEventCustomField, dateEditor, setDateEditor, openDateEditor, closeDateEditor, applyEventDate, openBranchSelector, openProductSelector, openStatusSelector, openManagedSingleSelector, openAttendantSelector, openCustomOptionSelector, branchStyles, branchFullNames, productStyles, productFullNames, statusStyles, managedSingleStyles, attendantStyles, customItemStyles, customColumns, customColumnWidths, setActiveRowId, openLocationPreview, mainNameSuggestions, hoursSuggestions, canEdit: effectiveColumnRights[column.key]?.canEdit ?? true })}</div>)}<div className="cell cell-actions"><button className="row-copy" type="button" title="Duplicate" onClick={() => duplicateEvent(event.id)} disabled={!canManageRows}>D</button><button className="row-delete" type="button" title="Delete" onClick={() => deleteEvent(event.id)} disabled={!canManageRows || (isPastEvent(event) && currentUser?.role !== 'admin')}>X</button></div></div>) : <div className="empty-month">No events in this month yet.</div>}
                    <button className="add-inline-row" type="button" onClick={() => addBlankEvent(month)} disabled={!canManageRows}>+ Add Event</button>
                    <div className="board-row totals-row" style={{ gridTemplateColumns: boardColumnTemplate, width: `${boardWidth}px` }}>{visibleColumns.map((column) => <div className={`cell cell-${column.key}`} key={column.key}>{column.key === 'name' ? <strong>Totals</strong> : column.type === 'number' ? currencyFormatter.format(totalsByColumn[column.key] || 0) : ''}</div>)}<div className="cell cell-actions" /></div>
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
          {selectedEvent ? <><div className="drawer-header"><div><div className="topbar-kicker">Event drawer</div><h3>{selectedEvent.name || 'New event'}</h3><p className="drawer-meta">{[formatDateDisplay(selectedEvent.date), selectedEvent.hours, (selectedEvent.branch || []).map((item) => branchFullNames[item] || item).join(', ')].filter(Boolean).join('   ')}</p>{selectedEvent.location ? <div className="drawer-location-row"><span className="drawer-location-text" title={selectedEvent.location}>{selectedEvent.location}</span>{typeof selectedEvent.locationLat === 'number' && typeof selectedEvent.locationLng === 'number' ? <button className="location-pin-button drawer-location-pin" type="button" title="View map" onClick={() => openLocationPreview(selectedEvent)}>{renderPinIcon()}</button> : null}</div> : null}</div><button className="drawer-close" type="button" onClick={closeDrawer}>x</button></div><div className="drawer-tabs">{[{ id: 'updates', label: 'Updates' }, { id: 'files', label: 'Files' }, { id: 'booking', label: 'Booking' }, { id: 'activity', label: 'Logs' }].map((tab) => <button className={drawerTab === tab.id ? 'is-active' : ''} key={tab.id} type="button" onClick={() => setDrawerTab(tab.id)}>{tab.label}</button>)}</div>{drawerTab === 'updates' ? <div className="drawer-section-stack"><section className="drawer-card"><h4>Updates / Notes</h4><textarea rows={4} value={draftUpdate} onChange={(event) => { const nextValue = event.target.value; setDraftUpdate(nextValue); setDraftUpdatesByEvent((current) => selectedEvent ? ({ ...current, [selectedEvent.id]: nextValue }) : current); }} placeholder="Click and type. Your note stays here until you click Update." /><div className="modal-actions"><button className="primary-button" type="button" onClick={saveQuickUpdate}>Update</button></div></section><section className="drawer-card"><h4>Update stream</h4><div className="activity-list">{selectedEventUpdates.map((entry) => <ActivityEntry entry={entry} title={entry.text} />)}</div></section></div> : null}{drawerTab === 'files' ? <div className="drawer-section-stack"><section className={`drawer-card file-upload-dropzone ${isFileDropActive ? 'is-drag-over' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsFileDropActive(true); }} onDragOver={(event) => { event.preventDefault(); setIsFileDropActive(true); }} onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setIsFileDropActive(false); }} onDrop={(event) => { void handleFileDrop(event); }}><h4>Accepted uploads</h4><p>PDF, JPG, PNG, JPEG</p><button className="primary-button" type="button" onClick={openEventFilePicker}>Upload file</button><p className="file-drop-hint">or drag and drop a file here</p><input ref={eventFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleEventFileSelection} /></section><section className="drawer-card"><h4>Files gallery</h4><div className="file-list">{selectedEventFiles.map((file) => <article className="file-card" key={file.id}><div className="file-card-main"><span>{file.type}</span><strong className="file-name" title={file.name}>{file.url ? <button className="file-name-button" type="button" title={file.name} onClick={() => openEventFilePreview(file)}>{file.name}</button> : file.name}</strong><p>{file.size || file.uploadedAt}</p></div><button className="file-delete" type="button" onClick={() => deleteEventFile(file.id)}>Delete</button></article>)}</div></section></div> : null}{drawerTab === 'booking' ? <div className="drawer-section-stack"><section className="drawer-card booking-link-card"><h4>Booking link</h4><p>Generate a unique booking form link for this event. The completed form is stored below and stays editable only through the booking link.</p><div className="modal-actions booking-link-actions"><button className="primary-button" type="button" onClick={() => void generateBookingLink()}>Generate Booking Link</button>{selectedEventBooking?.token ? <button className="ghost-button" type="button" onClick={() => openBookingLink(selectedEventBooking.token)}>Open link</button> : null}</div>{selectedEventBooking?.token ? <div className="booking-link-summary"><label><span>Active link</span><input className="text-input locked-input booking-link-input" readOnly value={buildBookingLinkUrl(selectedEventBooking.token)} onClick={() => void copyBookingLink(selectedEventBooking.token)} title="Click to copy booking link" /></label><div className="booking-link-meta"><span>Click the link field to copy the booking link.</span><span>This booking link stays available until the event day, when the form becomes read-only.</span>{selectedEventBooking.isLocked ? <span>Form is now locked for editing.</span> : null}{selectedEventBooking.submittedAt ? <span>Last submitted: {new Date(selectedEventBooking.submittedAt).toLocaleString()}</span> : <span>Not submitted yet</span>}</div></div> : <div className="empty-month">No booking link generated yet.</div>}</section><section className="drawer-card"><h4>Booking form data</h4>{selectedEventBooking ? <BookingDrawerSummary booking={selectedEventBooking} /> : <div className="empty-month">Generate the booking link to start collecting booking information.</div>}</section></div> : null}{drawerTab === 'activity' ? <section className="drawer-card"><h4>All activity</h4><div className="activity-list">{selectedEventActivity.map((entry) => <ActivityEntry entry={entry} title={entry.text} />)}</div></section> : null}</> : null}
        </aside>

      {previewFile ? <div className="modal-scrim" onClick={closeEventFilePreview}><div className="modal-panel file-preview-panel" role="dialog" aria-modal="true" aria-label={previewFile.name} onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3 title={previewFile.name}>{previewFile.name}</h3></div><div className="file-preview-body">{isPreviewImage(previewFile) ? <img className="file-preview-image" src={previewFile.url} alt={previewFile.name} /> : null}{!isPreviewImage(previewFile) && isPreviewPdf(previewFile) ? <iframe className="file-preview-frame" src={previewFile.url} title={previewFile.name} /> : null}{!isPreviewImage(previewFile) && !isPreviewPdf(previewFile) ? <div className="empty-month">This file cannot be previewed here yet.</div> : null}</div><div className="modal-actions"><a className="primary-button file-preview-link" href={previewFile.url} target="_blank" rel="noreferrer">Open in new tab</a></div></div></div> : null}

      {locationPreview ? <div className="modal-scrim" onClick={closeLocationPreview}><div className="modal-panel map-preview-panel" role="dialog" aria-modal="true" aria-label={locationPreview.title} onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><h3>{locationPreview.title}</h3><p className="map-preview-address" title={locationPreview.address}>{locationPreview.address}</p></div></div><LocationMapPreview location={locationPreview} /><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => void shareLocationPreview()}>Share</button><a className="ghost-button file-preview-link" href={buildGoogleMapsExternalUrl(locationPreview)} target="_blank" rel="noreferrer">Open in Google Maps</a></div></div></div> : null}

      {renameDialog.isOpen ? <ModalShell title="Rename header" onClose={closeRenameDialog}><div className="simple-stack"><label className="full-span"><span>Header name</span><input className="text-input" value={renameDialog.value} onChange={(event) => setRenameDialog((current) => ({ ...current, value: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveRenamedColumn(); } }} autoFocus /></label><div className="modal-actions"><button className="ghost-button" type="button" onClick={closeRenameDialog}>Cancel</button><button className="primary-button" type="button" onClick={saveRenamedColumn}>Save</button></div></div></ModalShell> : null}

      {rightsColumnKey ? <ModalShell title={`Manage rights for ${displayColumnLabel(allColumns.find((column) => column.key === rightsColumnKey) || { key: rightsColumnKey, label: rightsColumnKey, isCustom: false })}`} onClose={() => setRightsColumnKey('')}><div className="rights-modal"><section className="rights-section"><h4>Roles</h4><div className="rights-scroll">{['manager', 'user'].map((role) => { const permission = getColumnPermission(rightsColumnKey, 'role', role); const canView = permission?.canView ?? true; const canEdit = permission?.canEdit ?? true; return <div className="rights-row" key={role}><div className="rights-subject"><strong>{formatRole(role)}</strong><small>{permission ? 'Override active' : 'Inherited'}</small></div><label><input type="checkbox" checked={canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'role', role, { canView: event.target.checked })} />View</label><label><input type="checkbox" checked={canEdit} disabled={!canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'role', role, { canEdit: event.target.checked })} />Edit</label><button className="ghost-button compact-manager-button" type="button" onClick={() => void clearColumnPermission(rightsColumnKey, 'role', role)} disabled={!permission}>Clear</button></div>; })}</div></section><section className="rights-section"><h4>Users</h4><div className="rights-scroll">{users.filter((user) => user.role !== 'admin').map((user) => { const permission = getColumnPermission(rightsColumnKey, 'user', user.id); const canView = permission?.canView ?? true; const canEdit = permission?.canEdit ?? true; return <div className="rights-row" key={user.id}><div className="rights-subject"><strong>{user.firstName} {user.surname}</strong><small>{permission ? 'Override active' : 'Inherited'} ? {formatRole(user.role)}</small></div><label><input type="checkbox" checked={canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'user', user.id, { canView: event.target.checked })} />View</label><label><input type="checkbox" checked={canEdit} disabled={!canView} onChange={(event) => void saveColumnPermission(rightsColumnKey, 'user', user.id, { canEdit: event.target.checked })} />Edit</label><button className="ghost-button compact-manager-button" type="button" onClick={() => void clearColumnPermission(rightsColumnKey, 'user', user.id)} disabled={!permission}>Clear</button></div>; })}</div></section></div></ModalShell> : null}
      {filtersOpen ? <ModalShell title="Filters" onClose={() => setFiltersOpen(false)} hideCloseButton><div className="filter-popup-scroll"><div className="filter-popup"><FilterGroup title="Branches" options={branchOptions.map((option) => ({ value: option.abbreviation, label: option.fullName }))} selected={selectedBranches} onToggle={(value) => toggleSelection(setSelectedBranches, value)} /><FilterGroup title="Products" options={productOptions.map((option) => ({ value: option.abbreviation, label: option.fullName }))} selected={selectedProducts} onToggle={(value) => toggleSelection(setSelectedProducts, value)} /><FilterGroup title="Statuses" options={statusNames} selected={selectedStatuses} onToggle={(value) => toggleSelection(setSelectedStatuses, value)} /><FilterGroup title="Payment" options={getManagedOptionNames(managedSingleOptions, 'paymentStatus')} selected={selectedPayments} onToggle={(value) => toggleSelection(setSelectedPayments, value)} /><FilterGroup title="Attendants" options={attendantOptions.map((option) => option.fullName)} selected={selectedAttendants} onToggle={(value) => toggleSelection(setSelectedAttendants, value)} /></div></div><div className="modal-actions filter-popup-actions"><button className="ghost-button" type="button" onClick={clearFilters}>Clear filter</button><button className="ghost-button filter-save-button" type="button" onClick={openSaveCustomViewModal}>Save Custom View</button><button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Apply</button></div></ModalShell> : null}
      {saveFilterViewModalOpen ? <ModalShell title="Save custom view" onClose={() => setSaveFilterViewModalOpen(false)}><div className="simple-stack"><label><span>Name</span><input className="text-input" maxLength={15} value={newFilterViewName} onChange={(event) => setNewFilterViewName(event.target.value.slice(0, 15))} autoFocus /></label><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setSaveFilterViewModalOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={saveCustomFilterView}>Save</button></div></div></ModalShell> : null}
      {commissionDialog.isOpen ? <ModalShell title={`Commission - ${commissionDialog.month} ${selectedWorkspaceYear}`} onClose={closeCommissionDialog}><div className="commission-sheet"><div className="commission-toolbar"><label><span>Attendant</span><select value={commissionDialog.attendant} onChange={(event) => setCommissionDialog((current) => ({ ...current, attendant: event.target.value }))}><option value="">Select attendant</option>{commissionAttendantNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><div className="commission-periods"><button className={["ghost-button", commissionDialog.period === 'all' ? 'is-active' : ''].join(' ').trim()} type="button" onClick={() => setCommissionDialog((current) => ({ ...current, period: 'all' }))}>All events</button><button className={["ghost-button", commissionDialog.period === 'firstHalf' ? 'is-active' : ''].join(' ').trim()} type="button" onClick={() => setCommissionDialog((current) => ({ ...current, period: 'firstHalf' }))}>1-15</button><button className={["ghost-button", commissionDialog.period === 'secondHalf' ? 'is-active' : ''].join(' ').trim()} type="button" onClick={() => setCommissionDialog((current) => ({ ...current, period: 'secondHalf' }))}>16-end</button></div></div><div className="commission-subhead"><strong>SelfieBox commission sheet for:</strong><span>{getCommissionPeriodLabel(commissionDialog.month, selectedWorkspaceYear, commissionDialog.period)}</span><span>Attendant: {commissionDialog.attendant || '-'}</span></div><div className="commission-table-wrap"><div className="commission-table commission-table-header"><span>Event Name</span><span>Date</span><span>Hours</span><span>Hours Payable</span><span>Amount</span></div>{commissionRows.length ? commissionRows.map((row) => <div className="commission-table commission-table-row" key={row.id}><span title={row.eventName}>{row.eventName}</span><span>{formatDateDisplay(row.date || '') || '-'}</span><span>{row.hours}</span><input className="text-input commission-input" inputMode="numeric" value={row.hoursPayable} onChange={(event) => updateCommissionOverride(row.id, 'hoursPayable', event.target.value)} /><input className="text-input commission-input" inputMode="numeric" value={row.amount} onChange={(event) => updateCommissionOverride(row.id, 'amount', event.target.value)} /></div>) : <div className="empty-month">No commission rows for this selection.</div>}</div><div className="commission-signoff"><div><span>Signature</span><div className="commission-line" /></div><div><span>Date</span><div className="commission-line" /></div></div><div className="modal-actions"><button className="ghost-button" type="button" onClick={closeCommissionDialog}>Close</button><button className="primary-button" type="button" onClick={() => void exportCommissionSheet()}>Export to PDF</button></div></div></ModalShell> : null}
      {exportDialog.isOpen ? <ModalShell title={exportDialog.title} onClose={() => setExportDialog({ isOpen: false, title: '', filename: '', scope: 'workspace', sheets: [], selectedKeys: [] })}><div className="simple-stack export-dialog"><p>Select the columns to include in this export.</p><div className="export-column-grid">{visibleColumns.map((column) => <label className="export-column-option" key={column.key}><input type="checkbox" checked={exportDialog.selectedKeys.includes(column.key)} onChange={() => toggleExportColumn(column.key)} /><span>{displayColumnLabel(column)}</span></label>)}</div><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setExportDialog((current) => ({ ...current, selectedKeys: visibleColumns.map((column) => column.key) }))}>Select all</button><button className="ghost-button" type="button" onClick={() => setExportDialog({ isOpen: false, title: '', filename: '', scope: 'workspace', sheets: [], selectedKeys: [] })}>Cancel</button><button className="primary-button" type="button" onClick={runExport}>Export</button></div></div></ModalShell> : null}
        {branchManagerOpen ? <ModalShell title="Manage branch items" onClose={() => setBranchManagerOpen(false)} closeOnScrimClick={false}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-branch-manager-form"><input className="text-input compact-text-input" placeholder="Full name" value={newBranchFullName} onChange={(event) => setNewBranchFullName(event.target.value)} /><input className="text-input compact-text-input" maxLength={7} placeholder="Abbrev." value={newBranchAbbreviation} onChange={(event) => setNewBranchAbbreviation(event.target.value.toUpperCase().slice(0, 7))} /><ColorSwatchPicker value={newBranchColor} onChange={setNewBranchColor} className="compact-color-picker" /><button className="primary-button compact-manager-button" type="button" onClick={addBranchOption}>Add</button></div><div className="branch-preview-list is-editor">{branchOptions.map((option) => <div className="branch-editor-row compact-branch-editor-row" key={option.optionKey || option.abbreviation}><input className="text-input compact-text-input compact-name-input" value={branchDrafts[option.abbreviation]?.fullName ?? option.fullName} onChange={(event) => updateBranchDraft(option.abbreviation, 'fullName', event.target.value)} /><input className="text-input compact-text-input" maxLength={7} value={branchDrafts[option.abbreviation]?.abbreviation ?? option.abbreviation} onChange={(event) => updateBranchDraft(option.abbreviation, 'abbreviation', event.target.value)} /><ColorSwatchPicker value={branchDrafts[option.abbreviation]?.color ?? option.color} onChange={(value) => updateBranchDraft(option.abbreviation, 'color', value)} className="compact-color-picker" /><span className="branch-color-chip compact-branch-color-chip" style={{ background: branchDrafts[option.abbreviation]?.color ?? option.color, color: getContrastColor(branchDrafts[option.abbreviation]?.color ?? option.color) }} title={branchDrafts[option.abbreviation]?.fullName ?? option.fullName}>{branchDrafts[option.abbreviation]?.abbreviation ?? option.abbreviation}</span><div className="manager-action-group"><button className="ghost-button compact-manager-button" type="button" onClick={() => saveBranchOption(option.abbreviation)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteBranchOption(option.abbreviation)}>Delete</button></div></div>)}</div></div></ModalShell> : null}
      {branchEditorEventId && selectedBranchEvent ? <ModalShell title="Select branch" onClose={() => setBranchEditorEventId(null)}><div className="branch-manager"><div className="branch-selector-list">{branchOptions.map((option) => <button className={["branch-selector-item", selectedBranchEvent.branch.includes(option.abbreviation) ? "is-selected" : ""].join(" ").trim()} key={option.optionKey || option.abbreviation} type="button" title={option.fullName} onClick={() => toggleBranchOnEvent(selectedBranchEvent.id, option.abbreviation)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.abbreviation}</span></button>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setBranchEditorEventId(null)}>Done</button></div></div></ModalShell> : null}
        {productManagerOpen ? <ModalShell title="Manage product items" onClose={() => setProductManagerOpen(false)} closeOnScrimClick={false}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-product-manager-form"><input className="text-input compact-text-input" placeholder="Full name" value={newProductFullName} onChange={(event) => { const value = event.target.value; setNewProductFullName(value); setNewProductAbbreviation((current) => (current ? current : abbreviateLabel(value))); }} /><input className="text-input compact-text-input" maxLength={7} placeholder="Abbrev." value={newProductAbbreviation || abbreviateLabel(newProductFullName)} onChange={(event) => setNewProductAbbreviation(event.target.value.toUpperCase().slice(0, 7))} /><ColorSwatchPicker value={newProductColor} onChange={setNewProductColor} className="compact-color-picker" /><button className="primary-button compact-manager-button" type="button" onClick={addProductOption}>Add</button></div><div className="branch-preview-list is-editor">{productOptions.map((option) => <div className="branch-editor-row compact-product-editor-row" key={option.optionKey || option.abbreviation}><input className="text-input compact-text-input compact-name-input" value={productDrafts[option.optionKey || option.abbreviation]?.fullName ?? option.fullName} onChange={(event) => updateProductDraft(option.optionKey || option.abbreviation, 'fullName', event.target.value)} /><input className="text-input compact-text-input" maxLength={7} value={productDrafts[option.optionKey || option.abbreviation]?.abbreviation ?? option.abbreviation} onChange={(event) => updateProductDraft(option.optionKey || option.abbreviation, 'abbreviation', event.target.value)} /><ColorSwatchPicker value={productDrafts[option.optionKey || option.abbreviation]?.color ?? option.color} onChange={(value) => updateProductDraft(option.optionKey || option.abbreviation, 'color', value)} className="compact-color-picker" /><span className="branch-color-chip compact-branch-color-chip" style={{ background: productDrafts[option.optionKey || option.abbreviation]?.color ?? option.color, color: getContrastColor(productDrafts[option.optionKey || option.abbreviation]?.color ?? option.color) }} title={productDrafts[option.optionKey || option.abbreviation]?.fullName ?? option.fullName}>{productDrafts[option.optionKey || option.abbreviation]?.abbreviation ?? option.abbreviation}</span><div className="manager-action-group"><button className="ghost-button compact-manager-button" type="button" onClick={() => saveProductOption(option.optionKey || option.abbreviation)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteProductOption(option.optionKey || option.abbreviation)}>Delete</button></div></div>)}</div></div></ModalShell> : null}
      {productEditorEventId && selectedProductEvent ? <ModalShell title="Select product" onClose={() => setProductEditorEventId(null)}><div className="branch-manager"><div className="branch-selector-list">{productOptions.map((option) => <button className={["branch-selector-item", selectedProductEvent.products.includes(option.abbreviation) ? "is-selected" : ""].join(" ").trim()} key={option.optionKey || option.abbreviation} type="button" title={option.fullName} onClick={() => toggleProductOnEvent(selectedProductEvent.id, option.abbreviation)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.fullName}</span></button>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setProductEditorEventId(null)}>Done</button></div></div></ModalShell> : null}
      {statusManagerOpen ? <ModalShell title="Manage status items" onClose={() => setStatusManagerOpen(false)} closeOnScrimClick={false}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-status-manager-form"><input className="text-input compact-text-input" maxLength={15} placeholder="Status name" value={newStatusName} onChange={(event) => setNewStatusName(event.target.value.slice(0, 15))} /><ColorSwatchPicker value={newStatusColor} onChange={setNewStatusColor} className="compact-color-picker" /><button className="primary-button compact-manager-button" type="button" onClick={addStatusOption}>Add</button></div><div className="branch-preview-list is-editor">{statusOptions.map((option) => <div className="branch-editor-row compact-status-editor-row" key={option.name}><input className="text-input compact-text-input" maxLength={15} value={statusDrafts[option.name]?.name ?? option.name} onChange={(event) => updateStatusDraft(option.name, 'name', event.target.value)} /><ColorSwatchPicker value={statusDrafts[option.name]?.color ?? option.color} onChange={(value) => updateStatusDraft(option.name, 'color', value)} className="compact-color-picker" /><span className="branch-color-chip compact-branch-color-chip" style={{ background: statusDrafts[option.name]?.color ?? option.color, color: getContrastColor(statusDrafts[option.name]?.color ?? option.color) }}>{statusDrafts[option.name]?.name ?? option.name}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveStatusOption(option.name)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteStatusOption(option.name)}>Delete</button></div>)}</div></div></ModalShell> : null}
      {statusEditorEventId && selectedStatusEvent ? <ModalShell title="Select status" onClose={() => setStatusEditorEventId(null)}><div className="branch-manager"><div className="branch-selector-list">{statusOptions.map((option) => <button className={["branch-selector-item", selectedStatusEvent.status === option.name ? "is-selected" : ""].join(" ").trim()} key={option.name} type="button" onClick={() => selectStatusOnEvent(selectedStatusEvent.id, option.name)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.name}</span></button>)}</div></div></ModalShell> : null}
      {managedSingleManagerKey ? <ModalShell title={`Manage ${columnTitle(managedSingleManagerKey)} items`} onClose={() => setManagedSingleManagerKey('')} closeOnScrimClick={false}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-status-manager-form"><input className="text-input compact-text-input" maxLength={15} placeholder="Name" value={newManagedOptionName} onChange={(event) => setNewManagedOptionName(event.target.value.slice(0, 15))} /><ColorSwatchPicker value={newManagedOptionColor} onChange={setNewManagedOptionColor} className="compact-color-picker" /><button className="primary-button compact-manager-button" type="button" onClick={addManagedSingleOption}>Add</button></div><div className="branch-preview-list is-editor">{(managedSingleOptions[managedSingleManagerKey] || []).map((option) => <div className="branch-editor-row compact-status-editor-row" key={option.name}><input className="text-input compact-text-input" maxLength={15} value={((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.name) ?? option.name} onChange={(event) => updateManagedSingleDraft(managedSingleManagerKey, option.name, 'name', event.target.value)} /><ColorSwatchPicker value={((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.color) ?? option.color} onChange={(value) => updateManagedSingleDraft(managedSingleManagerKey, option.name, 'color', value)} className="compact-color-picker" /><span className="branch-color-chip compact-branch-color-chip" style={{ background: ((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.color) ?? option.color, color: getContrastColor(((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.color) ?? option.color) }}>{((managedSingleDrafts[managedSingleManagerKey] || {})[option.name]?.name) ?? option.name}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveManagedSingleOption(managedSingleManagerKey, option.name)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteManagedSingleOption(managedSingleManagerKey, option.name)}>Delete</button></div>)}</div></div></ModalShell> : null}
      {managedSingleEditor.columnKey && selectedManagedSingleEvent ? <ModalShell title={`Select ${columnTitle(managedSingleEditor.columnKey)}`} onClose={() => setManagedSingleEditor({ columnKey: '', eventId: '' })}><div className="branch-manager"><div className="branch-selector-list">{(managedSingleOptions[managedSingleEditor.columnKey] || []).map((option) => <button className={["branch-selector-item", selectedManagedSingleEvent[managedSingleEditor.columnKey] === option.name ? "is-selected" : ""].join(" ").trim()} key={option.name} type="button" onClick={() => selectManagedSingleValue(managedSingleEditor.columnKey, selectedManagedSingleEvent.id, option.name)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.name}</span></button>)}</div></div></ModalShell> : null}{customOptionManagerKey ? <ModalShell title={`Manage ${displayColumnLabel(customColumns.find((column) => column.key === customOptionManagerKey) || { label: customOptionManagerKey, isCustom: true })} items`} onClose={() => setCustomOptionManagerKey('')} closeOnScrimClick={false}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-status-manager-form"><input className="text-input compact-text-input" maxLength={40} placeholder="Name" value={newCustomOptionName} onChange={(event) => setNewCustomOptionName(event.target.value.slice(0, 40))} /><ColorSwatchPicker value={newCustomOptionColor} onChange={setNewCustomOptionColor} className="compact-color-picker" /><button className="primary-button compact-manager-button" type="button" onClick={addCustomOption}>Add</button></div><div className="branch-preview-list is-editor">{(customItemOptionsByColumn[customOptionManagerKey] || []).map((option) => <div className="branch-editor-row compact-status-editor-row" key={option.optionKey}><input className="text-input compact-text-input" maxLength={40} value={((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.name) ?? option.name} onChange={(event) => updateCustomOptionDraft(customOptionManagerKey, option.optionKey, 'name', event.target.value)} /><ColorSwatchPicker value={((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.color) ?? option.color} onChange={(value) => updateCustomOptionDraft(customOptionManagerKey, option.optionKey, 'color', value)} className="compact-color-picker" /><span className="branch-color-chip compact-branch-color-chip" style={{ background: ((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.color) ?? option.color, color: getContrastColor(((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.color) ?? option.color) }}>{((customOptionDrafts[customOptionManagerKey] || {})[option.optionKey]?.name) ?? option.name}</span><button className="ghost-button compact-manager-button" type="button" onClick={() => saveCustomOption(customOptionManagerKey, option.optionKey)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteCustomOption(customOptionManagerKey, option.optionKey)}>Delete</button></div>)}</div></div></ModalShell> : null}{customOptionEditor.columnKey && selectedCustomOptionEvent ? <ModalShell title={`Select ${displayColumnLabel(customColumns.find((column) => column.key === customOptionEditor.columnKey) || { label: customOptionEditor.columnKey, isCustom: true })}`} onClose={() => setCustomOptionEditor({ columnKey: '', eventId: '' })}><div className="branch-manager"><div className="branch-selector-list">{(customItemOptionsByColumn[customOptionEditor.columnKey] || []).map((option) => <button className={["branch-selector-item", customColumns.find((column) => column.key === customOptionEditor.columnKey)?.type === 'multiItem' ? (((selectedCustomOptionEvent.customFields || {})[customOptionEditor.columnKey] || []).includes(option.name) ? "is-selected" : "") : (((selectedCustomOptionEvent.customFields || {})[customOptionEditor.columnKey] === option.name) ? "is-selected" : "")].join(" ").trim()} key={option.optionKey} type="button" onClick={() => customColumns.find((column) => column.key === customOptionEditor.columnKey)?.type === 'multiItem' ? toggleCustomMultiValue(customOptionEditor.columnKey, selectedCustomOptionEvent.id, option.name) : selectCustomSingleValue(customOptionEditor.columnKey, selectedCustomOptionEvent.id, option.name)}><span className="branch-color-chip" style={{ background: option.color, color: getContrastColor(option.color) }}>{option.name}</span></button>)}</div>{customColumns.find((column) => column.key === customOptionEditor.columnKey)?.type === 'multiItem' ? <div className="modal-actions"><button className="primary-button" type="button" onClick={() => setCustomOptionEditor({ columnKey: '', eventId: '' })}>Done</button></div> : null}</div></ModalShell> : null}
      {attendantManagerOpen ? <ModalShell title="Manage attendant items" onClose={() => setAttendantManagerOpen(false)} closeOnScrimClick={false}><div className="branch-manager compact-branch-manager"><div className="branch-manager-form compact-attendant-manager-form"><input className="text-input compact-text-input" maxLength={100} placeholder="Full name" value={newAttendantName} onChange={(event) => setNewAttendantName(event.target.value.slice(0, 100))} /><select value={newAttendantBranch} onChange={(event) => setNewAttendantBranch(event.target.value)}><option value="">Branch</option>{branchOptions.map((option) => <option key={option.abbreviation} value={option.abbreviation}>{option.abbreviation}</option>)}</select><button className="primary-button compact-manager-button" type="button" onClick={addAttendantOption}>Add</button></div><div className="branch-preview-list is-editor">{attendantOptions.map((option) => <div className="branch-editor-row compact-attendant-editor-row" key={option.fullName}><input className="text-input compact-text-input" maxLength={100} value={attendantDrafts[option.fullName]?.fullName ?? option.fullName} onChange={(event) => updateAttendantDraft(option.fullName, 'fullName', event.target.value)} /><select value={attendantDrafts[option.fullName]?.branchKey ?? option.branchKey ?? ''} onChange={(event) => updateAttendantDraft(option.fullName, 'branchKey', event.target.value)}><option value="">Branch</option>{branchOptions.map((branchOption) => <option key={branchOption.abbreviation} value={branchOption.abbreviation}>{branchOption.abbreviation}</option>)}</select><span className="attendant-preview-chip" style={attendantStyles[attendantDrafts[option.fullName]?.fullName ?? option.fullName] || branchStyles[attendantDrafts[option.fullName]?.branchKey ?? option.branchKey ?? ''] || undefined} title={attendantDrafts[option.fullName]?.fullName ?? option.fullName}>{truncateName(attendantDrafts[option.fullName]?.fullName ?? option.fullName)}</span><div className="manager-action-group"><button className="ghost-button compact-manager-button" type="button" onClick={() => saveAttendantOption(option.fullName)}>Save</button><button className="branch-delete-button compact-manager-button" type="button" onClick={() => deleteAttendantOption(option.fullName)}>Delete</button></div></div>)}</div></div></ModalShell> : null}
      {attendantEditorEventId && selectedAttendantEvent ? <ModalShell title="Select attendant/s" onClose={() => setAttendantEditorEventId('')}><div className="branch-manager"><div className="branch-selector-list">{filteredAttendantOptions.map((option) => <button className={["branch-selector-item", (selectedAttendantEvent.attendants || []).includes(option.fullName) ? "is-selected" : ""].join(" ").trim()} key={option.fullName} type="button" title={option.fullName} onClick={() => toggleAttendantOnEvent(selectedAttendantEvent.id, option.fullName)}><span className="attendant-selector-name" style={attendantStyles[option.fullName] || undefined}>{truncateName(option.fullName)}</span></button>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setAttendantEditorEventId('')}>Done</button></div></div></ModalShell> : null}
        {showAddColumnModal ? <ModalShell title="Add new column" onClose={() => setShowAddColumnModal(false)} closeOnScrimClick={false}><form className="simple-stack" onSubmit={handleAddCustomColumn}><label><span>Column name</span><input className="text-input" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} autoFocus /></label><label><span>Column type</span><select value={newColumnType} onChange={(event) => setNewColumnType(event.target.value)}>{CUSTOM_COLUMN_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setShowAddColumnModal(false)}>Cancel</button><button className="primary-button" type="submit">Add column</button></div></form></ModalShell> : null}{showAddModal ? <ModalShell title="Add new event" onClose={() => setShowAddModal(false)} closeOnScrimClick={false}><form className="modal-form" onSubmit={handleAddEvent}>{renderEventFields(eventForm, setEventForm, branchAbbreviations, branchFullNames, productAbbreviations, productFullNames, statusNames, getManagedOptionNames(managedSingleOptions, 'paymentStatus'), getManagedOptionNames(managedSingleOptions, 'accounts'), getManagedOptionNames(managedSingleOptions, 'vinyl'), attendantOptions, openLocationPreview, mainNameSuggestions, hoursSuggestions)}<div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setShowAddModal(false)}>Cancel</button><button className="primary-button" type="submit">Save event</button></div></form></ModalShell> : null}
      {showProfileModal ? <ModalShell title="Profile" onClose={() => setShowProfileModal(false)} hideCloseButton><div className="profile-modal"><section className="profile-hero"><div className="profile-avatar-shell">{profileForm.profilePic ? <img className="profile-avatar-image" src={profileForm.profilePic} alt="Profile" /> : <div className="profile-avatar-fallback">{`${profileForm.firstName?.[0] || currentUser.firstName?.[0] || ''}${profileForm.surname?.[0] || currentUser.surname?.[0] || ''}`.toUpperCase() || 'SB'}</div>}</div><div className="profile-hero-copy"><strong>{profileForm.firstName || currentUser.firstName} {profileForm.surname || currentUser.surname}</strong><span>{profileForm.designation || currentUser.designation}</span><div className="profile-upload-stack"><label className="profile-upload-button">{profileForm.profilePic ? 'Change profile photo' : 'Upload profile photo'}<input type="file" accept="image/*" onChange={(event) => handleProfileImageChange(event, setProfileForm)} /></label><small>Maximum file size: 1 MB</small></div></div></section><div className="profile-edit-grid"><label><span>Name</span><input className="text-input" value={profileForm.firstName} onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))} /></label><label><span>Surname</span><input className="text-input" value={profileForm.surname} onChange={(event) => setProfileForm((current) => ({ ...current, surname: event.target.value }))} /></label><label className="full-span"><span>Designation</span><input className="text-input" value={profileForm.designation} onChange={(event) => setProfileForm((current) => ({ ...current, designation: event.target.value }))} /></label><label><span>Email</span><input className="text-input locked-input" value={profileForm.email} readOnly /></label><label><span>Role</span><input className="text-input locked-input" value={profileForm.role} readOnly /></label><label className="full-span"><span>Theme</span><select className="text-input" value={profileForm.theme} onChange={(event) => setProfileForm((current) => ({ ...current, theme: event.target.value === 'dark' ? 'dark' : 'light' }))}><option value="light">Light</option><option value="dark">Dark</option></select></label></div><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => { setShowProfileModal(false); void signOut(); }}>Logout</button><button className="ghost-button" type="button" onClick={() => setShowProfileModal(false)}>Cancel</button><button className="primary-button" type="button" onClick={saveProfile}>Save profile</button></div></div></ModalShell> : null}
      {showUsersModal ? <ModalShell title="Manage users" onClose={() => setShowUsersModal(false)}><div className="users-modal">{users.map((user) => <button className="user-list-card" type="button" key={user.id} onClick={() => openUserEditor(user.id)}><div className="user-list-avatar">{`${user.firstName?.[0] || ''}${user.surname?.[0] || ''}`.toUpperCase() || 'SB'}</div><div className="user-list-copy"><strong>{user.firstName} {user.surname}</strong><span>{user.email}</span></div><div className="user-list-meta"><span className={`role-pill role-${user.role}`}>{formatRole(user.role)}</span><small>{user.isApproved ? 'Approved' : 'Pending'}</small></div></button>)}</div></ModalShell> : null}
      {editingUser ? <ModalShell title="User profile" onClose={() => setEditingUserId('')} hideCloseButton><div className="profile-modal"><section className="profile-hero"><div className="profile-avatar-shell">{managedUserForm.profilePic ? <img className="profile-avatar-image" src={managedUserForm.profilePic} alt="User profile" /> : <div className="profile-avatar-fallback">{`${managedUserForm.firstName?.[0] || editingUser.firstName?.[0] || ''}${managedUserForm.surname?.[0] || editingUser.surname?.[0] || ''}`.toUpperCase() || 'SB'}</div>}</div><div className="profile-hero-copy"><strong>{managedUserForm.firstName || editingUser.firstName} {managedUserForm.surname || editingUser.surname}</strong><span>{managedUserForm.designation || editingUser.designation}</span><div className="profile-upload-stack"><label className="profile-upload-button">{managedUserForm.profilePic ? 'Change profile photo' : 'Upload profile photo'}<input type="file" accept="image/*" onChange={(event) => handleProfileImageChange(event, setManagedUserForm)} /></label><small>Maximum file size: 1 MB</small></div></div></section><div className="profile-edit-grid"><label><span>Name</span><input className="text-input" value={managedUserForm.firstName} onChange={(event) => setManagedUserForm((current) => ({ ...current, firstName: event.target.value }))} /></label><label><span>Surname</span><input className="text-input" value={managedUserForm.surname} onChange={(event) => setManagedUserForm((current) => ({ ...current, surname: event.target.value }))} /></label><label className="full-span"><span>Designation</span><input className="text-input" value={managedUserForm.designation} onChange={(event) => setManagedUserForm((current) => ({ ...current, designation: event.target.value }))} /></label><label className="full-span"><span>Email</span><input className="text-input" value={managedUserForm.email} onChange={(event) => setManagedUserForm((current) => ({ ...current, email: event.target.value }))} /></label><label><span>Role</span><select value={managedUserForm.role} onChange={(event) => setManagedUserForm((current) => ({ ...current, role: event.target.value }))}>{ROLE_OPTIONS.map((role) => <option key={role} value={role}>{formatRole(role)}</option>)}</select></label><label className="approval-toggle"><span>Approve / Activate</span><input type="checkbox" checked={managedUserForm.isApproved} onChange={(event) => setManagedUserForm((current) => ({ ...current, isApproved: event.target.checked }))} /><strong>{managedUserForm.isApproved ? 'Approved' : 'Pending approval'}</strong></label></div><div className="modal-actions profile-admin-actions"><button className="ghost-button" type="button" onClick={() => setEditingUserId('')}>Cancel</button><button className="branch-delete-button danger-button" type="button" onClick={deleteManagedUser}>Delete user</button><button className="primary-button" type="button" onClick={saveManagedUser}>Save user</button></div></div></ModalShell> : null}
      {showWorkspaceModal ? <div className="modal-scrim" onClick={() => setShowWorkspaceModal(false)}><div className="modal-panel add-year-panel" role="dialog" aria-modal="true" aria-label="Add year" onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>Add year</h3></div><div className="simple-stack add-year-confirm"><p>Are you sure you want to add {nextWorkspaceYear}?</p><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => setShowWorkspaceModal(false)}>No</button><button className="primary-button" type="button" onClick={handleCreateWorkspace}>Yes</button></div></div></div></div> : null}
      {confirmDialog.isOpen ? <ModalShell title={confirmDialog.title} onClose={() => closeConfirmation(false)}><div className="simple-stack"><p>{confirmDialog.message}</p><div className="modal-actions"><button className="ghost-button" type="button" onClick={() => closeConfirmation(false)}>Cancel</button><button className={confirmDialog.tone === 'danger' ? 'branch-delete-button danger-button' : 'primary-button'} type="button" onClick={() => closeConfirmation(true)}>{confirmDialog.confirmLabel}</button></div></div></ModalShell> : null}
      {noticeDialog.isOpen ? <ModalShell title={noticeDialog.title} onClose={closeNotice}><div className="simple-stack"><p>{noticeDialog.message}</p><div className="modal-actions"><button className="primary-button" type="button" onClick={closeNotice}>OK</button></div></div></ModalShell> : null}
    </div>
  );
}

function renderPinIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-5.5-5.64-5.5-10A5.5 5.5 0 0 1 12 5.5 5.5 5.5 0 0 1 17.5 11c0 4.36-5.5 10-5.5 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="currentColor" /></svg>;
}

function buildGoogleMapsExternalUrl(location) {
  if (typeof location?.locationLat === 'number' && typeof location?.locationLng === 'number') {
    return 'https://www.google.com/maps/search/?api=1&query=' + location.locationLat + ',' + location.locationLng;
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location?.address || location?.location || '');
}

function renderSearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm8.91 11.5 2.3 2.29-1.42 1.42-2.29-2.3 1.41-1.41Z" fill="currentColor" /></svg>;
}

function LocationInputField({ value, title, placeholder, readOnly, className = 'inline-input', compact = false, onFocus, onTextChange, onPlaceSelect, onOpenMap, hasCoordinates }) {
  const wrapperRef = useRef(null);
  const autocompleteContainerRef = useRef(null);
  const autocompleteElementRef = useRef(null);
  const placeSelectHandlerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (readOnly || !hasGoogleMapsApiKey()) {
      return;
    }
    void loadGooglePlacesLibrary().catch((error) => {
      console.error('Google Places library failed to preload', error);
    });
  }, [readOnly]);

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
    let mountTimeoutId = null;
    let focusTimeoutId = null;

    const mountAutocomplete = async () => {
      try {
        const placesLibrary = await loadGooglePlacesLibrary();
        if (!isMounted || !autocompleteContainerRef.current) {
          return;
        }

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

        focusTimeoutId = window.setTimeout(() => {
          autocompleteElementRef.current?.focus?.();
        }, 30);
      } catch (error) {
        console.error('Google Maps autocomplete failed to load', error);
      }
    };

    mountTimeoutId = window.setTimeout(() => {
      void mountAutocomplete();
    }, 30);

    return () => {
      isMounted = false;
      if (mountTimeoutId != null) {
        window.clearTimeout(mountTimeoutId);
      }
      if (focusTimeoutId != null) {
        window.clearTimeout(focusTimeoutId);
      }
    };
  }, [compact, isOpen, onPlaceSelect, placeholder, readOnly, value]);

  return <div ref={wrapperRef} className={[compact ? 'location-field compact' : 'location-field', hasCoordinates ? 'has-pin' : '', isOpen ? 'is-open' : ''].join(' ').trim()}><input className={className} title={title || value || ''} value={value || ''} readOnly={readOnly} placeholder={placeholder} onFocus={onFocus} onChange={(event) => onTextChange?.(event.target.value)} />{!readOnly && hasGoogleMapsApiKey() ? <button className="location-search-button" type="button" title="Search with Google Maps" onClick={() => setIsOpen((current) => !current)}>{renderSearchIcon()}</button> : null}{hasCoordinates ? <button className="location-pin-button" type="button" title="View map" onClick={onOpenMap}>{renderPinIcon()}</button> : null}{isOpen ? <div className="location-autocomplete-popover"><div ref={autocompleteContainerRef} className="location-autocomplete-host" /><button className="ghost-button location-autocomplete-close" type="button" onClick={() => setIsOpen(false)}>Close</button></div> : null}</div>;
}

function LocationMapPreview({ location }) {
  const mapRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    let marker = null;
    let map = null;
    let initTimeoutId = null;
    let resizeTimeoutId = null;

    void loadGoogleMapsApi().then(() => {
      if (!isActive || !mapRef.current || !window.google?.maps || typeof location?.locationLat !== 'number' || typeof location?.locationLng !== 'number') {
        return;
      }

      initTimeoutId = window.setTimeout(() => {
        if (!isActive || !mapRef.current) {
          return;
        }

        const center = { lat: location.locationLat, lng: location.locationLng };
        map = new window.google.maps.Map(mapRef.current, {
          center,
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        marker = new window.google.maps.Marker({ position: center, map });

        resizeTimeoutId = window.setTimeout(() => {
          if (!isActive || !map) {
            return;
          }
          if (window.google?.maps?.event?.trigger) {
            window.google.maps.event.trigger(map, 'resize');
          }
          map.setCenter(center);
        }, 60);
      }, 30);
    }).catch((error) => {
      console.error('Google Maps preview failed to load', error);
    });

    return () => {
      isActive = false;
      if (initTimeoutId != null) {
        window.clearTimeout(initTimeoutId);
      }
      if (resizeTimeoutId != null) {
        window.clearTimeout(resizeTimeoutId);
      }
      if (marker?.setMap) {
        marker.setMap(null);
      }
    };
  }, [location]);

  return <div className="map-preview-canvas" ref={mapRef} />;
}

function renderEventFields(
  form,
  setForm,
  branchAbbreviations,
  branchFullNames,
  productAbbreviations,
  productFullNames,
  statusNames,
  paymentNames,
  accountNames,
  yesNoNames,
  attendantOptions,
  openLocationPreview,
  mainNameSuggestions,
  hoursSuggestions
) {
  const groupedAttendants = [];
  const branchBuckets = new Map();
  const ungrouped = [];

  (attendantOptions || []).forEach((option) => {
    const fullName = String(option?.fullName || "").trim();
    if (!fullName) {
      return;
    }
    const branchKey = String(option?.branchKey || "").trim();
    if (!branchKey) {
      ungrouped.push(fullName);
      return;
    }
    const list = branchBuckets.get(branchKey) || [];
    list.push(fullName);
    branchBuckets.set(branchKey, list);
  });

  branchAbbreviations.forEach((branchKey) => {
    const names = (branchBuckets.get(branchKey) || []).slice().sort((left, right) => left.localeCompare(right));
    if (names.length) {
      groupedAttendants.push({
        label: branchFullNames[branchKey] || branchKey,
        options: names,
      });
    }
  });

  if (ungrouped.length) {
    groupedAttendants.push({
      label: "Other",
      options: ungrouped.slice().sort((left, right) => left.localeCompare(right)),
    });
  }

  return (
    <>
      <label>
        <span>Name / Item</span>
        <AutocompleteTextInput
          className="text-input"
          required
          value={form.name}
          suggestions={mainNameSuggestions}
          minMenuWidth={320}
          onChange={(nextValue) => setForm((current) => ({ ...current, name: nextValue }))}
        />
      </label>
      <label>
        <span>Event name</span>
        <input
          className="text-input"
          placeholder="Event Name"
          value={form.eventTitle || ""}
          onChange={(event) => setForm((current) => ({ ...current, eventTitle: event.target.value }))}
        />
      </label>
      <label>
        <span>Date</span>
        <input
          className="text-input"
          type="date"
          required
          value={form.date}
          onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
        />
      </label>
      <label>
        <span>Hours</span>
        <AutocompleteTextInput
          className="text-input"
          value={form.hours}
          suggestions={hoursSuggestions}
          minMenuWidth={160}
          onChange={(nextValue) => setForm((current) => ({ ...current, hours: nextValue }))}
        />
      </label>
      <label>
        <span>Branch</span>
        <select value={form.branch[0]} onChange={(event) => setForm((current) => ({ ...current, branch: [event.target.value] }))}>
          {branchAbbreviations.map((option) => (
            <option key={option} value={option} title={branchFullNames[option] || option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Product</span>
        <select value={form.products[0] || ""} onChange={(event) => setForm((current) => ({ ...current, products: event.target.value ? [event.target.value] : [] }))}>
          <option value="">Select product</option>
          {productAbbreviations.map((option) => (
            <option key={option} value={option} title={productFullNames[option] || option}>
              {productFullNames[option] || option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Status</span>
        <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
          {statusNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
        <label className="full-span">
          <span>Location</span>
          <LocationInputField
            value={form.location || ""}
            placeholder="Start typing address"
            className="text-input"
            onTextChange={(nextValue) => setForm((current) => ({ ...current, location: nextValue, locationPlaceId: "", locationLat: null, locationLng: null }))}
            onPlaceSelect={(place) => setForm((current) => ({ ...current, ...place }))}
            onOpenMap={() => openLocationPreview({ name: form.name || "New event", location: form.location || "", locationLat: form.locationLat, locationLng: form.locationLng })}
            hasCoordinates={typeof form.locationLat === "number" && typeof form.locationLng === "number"}
          />
        </label>
      <label>
        <span>Payment</span>
        <select value={form.paymentStatus} onChange={(event) => setForm((current) => ({ ...current, paymentStatus: event.target.value }))}>
          {paymentNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Accounts</span>
        <select value={form.accounts} onChange={(event) => setForm((current) => ({ ...current, accounts: event.target.value }))}>
          {accountNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Vinyl</span>
        <select value={form.vinyl} onChange={(event) => setForm((current) => ({ ...current, vinyl: event.target.value }))}>
          {yesNoNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>GS / AI</span>
        <select value={form.gsAi} onChange={(event) => setForm((current) => ({ ...current, gsAi: event.target.value }))}>
          {yesNoNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Images sent</span>
        <select value={form.imagesSent} onChange={(event) => setForm((current) => ({ ...current, imagesSent: event.target.value }))}>
          {yesNoNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Snappic</span>
        <select value={form.snappic} onChange={(event) => setForm((current) => ({ ...current, snappic: event.target.value }))}>
          {yesNoNames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Attendant/s</span>
        <select value={form.attendants[0] || ""} onChange={(event) => setForm((current) => ({ ...current, attendants: event.target.value ? [event.target.value] : [] }))}>
          <option value="">Select attendant</option>
          {groupedAttendants.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option} value={option} title={option}>
                  {option}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        <span>Ex. VAT</span>
        <input className="text-input" value={form.exVat} onChange={(event) => setForm((current) => ({ ...current, exVat: event.target.value }))} />
      </label>
      <label>
        <span>Package only</span>
        <input className="text-input" value={form.packageOnly} onChange={(event) => setForm((current) => ({ ...current, packageOnly: event.target.value }))} />
      </label>
    </>
  );
}
function renderCell({ columnKey, event, openDrawer, updateEventField, updateEventLocationText, applyEventLocation, updateEventCustomField, dateEditor, setDateEditor, openDateEditor, closeDateEditor, applyEventDate, openBranchSelector, openProductSelector, openStatusSelector, openManagedSingleSelector, openAttendantSelector, openCustomOptionSelector, branchStyles, branchFullNames, productStyles, productFullNames, statusStyles, managedSingleStyles, attendantStyles, customItemStyles, customColumns, customColumnWidths, setActiveRowId, openLocationPreview, mainNameSuggestions, hoursSuggestions, canEdit }) {
    if (columnKey === 'name') return <div className="name-cell"><button className="plus-trigger" type="button" onClick={() => openDrawer(event.id)}>-</button><span className="row-creator-avatar" title={event.createdByName || 'Created by user'}>{event.createdByProfilePic ? <img src={event.createdByProfilePic} alt={event.createdByName || 'Creator'} /> : getInitials(event.createdByName || '')}</span><div className="name-cell-copy"><AutocompleteTextInput className="inline-input inline-name" title={event.name} value={event.name} readOnly={!canEdit} suggestions={mainNameSuggestions} minMenuWidth={320} onFocus={() => setActiveRowId(event.id)} onChange={(nextValue) => updateEventField(event.id, 'name', nextValue)} /><input className="inline-input inline-event-title" title={event.eventTitle || ''} placeholder="Event Name" value={event.eventTitle || ''} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'eventTitle', inputEvent.target.value)} /></div></div>;
  if (columnKey === 'hours') return <AutocompleteTextInput className="inline-input inline-hours" title={event.hours} value={event.hours} readOnly={!canEdit} suggestions={hoursSuggestions} minMenuWidth={150} onFocus={() => setActiveRowId(event.id)} onChange={(nextValue) => updateEventField(event.id, 'hours', nextValue)} />;
  if (columnKey === 'location') return <LocationInputField value={event.location || ''} title={event.location || ''} readOnly={!canEdit} placeholder='Start typing address' onFocus={() => setActiveRowId(event.id)} onTextChange={(nextValue) => updateEventLocationText(event.id, nextValue)} onPlaceSelect={(place) => applyEventLocation(event.id, place)} onOpenMap={() => openLocationPreview(event)} hasCoordinates={typeof event.locationLat === 'number' && typeof event.locationLng === 'number'} compact />;
  if (columnKey === 'exVat') return <input className="inline-input inline-number" value={event.exVat ?? ''} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'exVat', inputEvent.target.value)} />;
  if (columnKey === 'exVatAuto') return <span title={String(event.exVatAuto || '')}>{event.exVatAuto || ''}</span>;
  if (columnKey === 'packageOnly') return <input className="inline-input inline-number" value={event.packageOnly ?? ''} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventField(event.id, 'packageOnly', inputEvent.target.value)} />;
  if (columnKey === 'quoteNumber' || columnKey === 'invoiceNumber') return <span title={event[columnKey] || ''}>{event[columnKey] || ''}</span>;
  if (columnKey === 'date') return dateEditor.eventId === event.id && dateEditor.columnKey === 'date' ? <DateInlineEditor value={dateEditor.value} onChange={(nextValue) => setDateEditor((current) => ({ ...current, value: nextValue }))} onCancel={closeDateEditor} onApply={() => applyEventDate(event.id, dateEditor.value, 'date')} /> : <button className='cell-select-button date-cell-button' type='button' title={event.date || ''} disabled={!canEdit} onClick={() => openDateEditor(event, 'date')}><span>{formatDateDisplay(event.date) || 'Pick date'}</span></button>;
  if (columnKey === 'branch') return <button className='cell-select-button' type='button' title={event.branch.map((item) => branchFullNames[item] || item).join(', ')} disabled={!canEdit} onClick={() => openBranchSelector(event.id)}><CompactTagList items={event.branch} styles={branchStyles} /></button>;
  if (columnKey === 'products') return <button className='cell-select-button' type='button' title={event.products.map((item) => productFullNames[item] || item).join(', ')} disabled={!canEdit} onClick={() => openProductSelector(event.id)}><CompactTagList items={event.products} styles={productStyles} /></button>;
  if (columnKey === 'status') return <button className='cell-select-button' type='button' title={event.status || ''} disabled={!canEdit} onClick={() => openStatusSelector(event.id)}><Tag value={event.status || ''} styles={statusStyles} placeholder='' /></button>;
  if (columnKey === 'paymentStatus') return <button className='cell-select-button' type='button' title={event.paymentStatus || ''} disabled={!canEdit} onClick={() => openManagedSingleSelector('paymentStatus', event.id)}><Tag value={event.paymentStatus || ''} styles={managedSingleStyles.paymentStatus || {}} placeholder='' width={90} className='managed-finance-pill' /></button>;
  if (columnKey === 'accounts') return <button className='cell-select-button' type='button' title={event.accounts || ''} disabled={!canEdit} onClick={() => openManagedSingleSelector('accounts', event.id)}><Tag value={event.accounts || ''} styles={managedSingleStyles.accounts || {}} placeholder='' width={90} className='managed-finance-pill' /></button>;
  if (['vinyl', 'gsAi', 'imagesSent', 'snappic'].includes(columnKey)) return <button className='cell-select-button' type='button' title={event[columnKey] || ''} disabled={!canEdit} onClick={() => openManagedSingleSelector(columnKey, event.id)}><Tag value={event[columnKey] || ''} styles={managedSingleStyles[columnKey] || {}} placeholder='' /></button>;
  if (columnKey === 'attendants') return <button className='cell-select-button' type='button' title={(event.attendants || []).join(', ')} disabled={!canEdit} onClick={() => openAttendantSelector(event.id)}><CompactNameList items={event.attendants || []} styles={attendantStyles} /></button>;

  const customColumn = customColumns.find((column) => column.key === columnKey);
  if (customColumn) {
    const customValue = (event.customFields || {})[columnKey];
    if (customColumn.type === 'text') return <input className="inline-input" title={String(customValue || '')} value={String(customValue || '')} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventCustomField(event.id, columnKey, inputEvent.target.value)} />;
    if (customColumn.type === 'number') return <input className="inline-input inline-number" value={String(customValue || '')} readOnly={!canEdit} onFocus={() => setActiveRowId(event.id)} onChange={(inputEvent) => updateEventCustomField(event.id, columnKey, inputEvent.target.value)} />;
    if (customColumn.type === 'date') return dateEditor.eventId === event.id && dateEditor.columnKey === columnKey ? <DateInlineEditor value={String(customValue || dateEditor.value || '')} onChange={(nextValue) => setDateEditor((current) => ({ ...current, value: nextValue }))} onCancel={closeDateEditor} onApply={() => applyEventDate(event.id, dateEditor.value, columnKey)} /> : <button className='cell-select-button date-cell-button' type='button' title={String(customValue || '')} disabled={!canEdit} onClick={() => openDateEditor(event, columnKey)}><span>{formatDateDisplay(String(customValue || '')) || 'Pick date'}</span></button>;
    if (customColumn.type === 'singleItem') return <button className='cell-select-button custom-single-select-button' style={customColumnWidths[columnKey] ? { width: customColumnWidths[columnKey], minWidth: customColumnWidths[columnKey] } : undefined} type='button' title={String(customValue || '')} disabled={!canEdit} onClick={() => openCustomOptionSelector(columnKey, event.id)}><CustomSingleTag value={String(customValue || '')} styles={customItemStyles[columnKey] || {}} width={customColumnWidths[columnKey]} placeholder='' /></button>;
    if (customColumn.type === 'multiItem') return <button className='cell-select-button' type='button' title={(Array.isArray(customValue) ? customValue : []).join(', ')} disabled={!canEdit} onClick={() => openCustomOptionSelector(columnKey, event.id)}><CompactTagList items={Array.isArray(customValue) ? customValue : []} styles={customItemStyles[columnKey] || {}} wide /></button>;
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

function getSavedFilterViewsStorageKey(userId) {
  return `selfiebox-saved-filter-views-${userId}`;
}

function getActiveFilterStateStorageKey(userId) {
  return `selfiebox-active-filter-state-${userId}`;
}

function columnTitle(columnKey) {
  const titles = { paymentStatus: 'Payment', accounts: 'Accounts', vinyl: 'Vinyl', gsAi: 'GS / AI', imagesSent: 'Images Sent', snappic: 'Snappic' };
  return titles[columnKey] || columnKey;
}

function AutocompleteTextInput({ value, onChange, suggestions = [], readOnly = false, className = '', onFocus, title, placeholder, required = false, minMenuWidth = 220 }) {
  const [isFocused, setIsFocused] = useState(false);
  const wrapperRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);
  const normalizedValue = String(value || '');
  const normalizedPrefix = normalizedValue.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalizedPrefix) {
      return [];
    }

    return suggestions
      .filter((option) => option.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 8);
  }, [normalizedPrefix, suggestions]);

  const showSuggestions = !readOnly && isFocused && normalizedPrefix.length > 0 && matches.length > 0;

  useLayoutEffect(() => {
    if (!showSuggestions || !wrapperRef.current) {
      return;
    }

    const updatePosition = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      setMenuStyle({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: Math.max(minMenuWidth, rect.width),
        maxWidth: Math.max(minMenuWidth, 380),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showSuggestions, minMenuWidth, normalizedValue]);

  return (
    <div ref={wrapperRef} className="autocomplete-field">
      <input
        className={className}
        title={title}
        value={normalizedValue}
        readOnly={readOnly}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            setIsFocused(false);
          }, 120);
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {showSuggestions && menuStyle ? createPortal(
        <div className="autocomplete-popover autocomplete-popover-portal" style={menuStyle}>
          {matches.map((option) => (
            <button
              key={option}
              className="autocomplete-option"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(option);
                setIsFocused(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function ColorSwatchPicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);
  const palette = value && !COLOR_SWATCHES.includes(value) ? [value, ...COLOR_SWATCHES] : COLOR_SWATCHES;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current) {
        return;
      }

      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 228;
      const estimatedHeight = 170;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, viewportWidth - menuWidth - 8)
      );
      const openAbove = rect.bottom + estimatedHeight > viewportHeight - 8 && rect.top > estimatedHeight;
      const top = openAbove
        ? Math.max(8, rect.top - estimatedHeight - 6)
        : Math.min(viewportHeight - estimatedHeight - 8, rect.bottom + 6);

      setMenuStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${menuWidth}px`,
        zIndex: 1300,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleOutsideClick = (event) => {
      const withinTrigger = pickerRef.current?.contains(event.target);
      const withinPopover = popoverRef.current?.contains(event.target);
      if (!withinTrigger && !withinPopover) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div ref={pickerRef} className={['color-swatch-picker-wrap', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        className="color-swatch-trigger"
        type="button"
        aria-label="Choose color"
        title={value || 'Choose color'}
        onClick={() => setOpen((current) => !current)}
        style={{ background: value || '#d6d6d6' }}
      />
      {open && menuStyle ? createPortal(
        <div ref={popoverRef} className="color-swatch-popover color-swatch-popover-portal" style={menuStyle}>
          <div className="color-swatch-picker">
            {palette.map((color) => (
              <button
                key={color}
                className={['color-swatch-button', value === color ? 'is-selected' : ''].join(' ').trim()}
                type="button"
                aria-label={`Select color ${color}`}
                title={color}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                style={{ background: color }}
              />
            ))}
          </div>
          <label className="color-swatch-custom">
            <span>Custom</span>
            <input
              className="color-swatch-native-input"
              type="color"
              value={value || '#d6d6d6'}
              onChange={(event) => {
                onChange(event.target.value);
              }}
            />
          </label>
        </div>,
        document.body
      ) : null}
    </div>
  );
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
  const monthIndex = Number(month) - 1;
  const shortMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex];
  if (!shortMonth) return value;
  return Number(day) + ' ' + shortMonth;
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

function CompactNameList({ items, styles = {} }) {
  if (!items || items.length === 0) return <span className="empty-cell-value" />;
  const firstItem = items[0];
  const overflowCount = items.length - 1;
  return <div className="compact-name-wrap"><div className="compact-tag-slot"><span className="compact-name-pill" style={styles[firstItem] || undefined} title={firstItem}>{truncateName(firstItem)}</span>{overflowCount > 0 ? <span className="extra-pill extra-pill-corner">+{overflowCount}</span> : null}</div></div>;
}

function CompactTagList({ items, styles, wide = false }) {
  if (!items || items.length === 0) return <span className="empty-cell-value" />;
  const visibleItems = items.slice(0, 2);
  const overflowCount = items.length - visibleItems.length;
  return <div className={`compact-tag-wrap${wide ? ' is-wide' : ''}`}>{visibleItems.map((item, index) => <div className="compact-tag-slot" key={String(item) + '-' + index}><Tag value={item} styles={styles} />{index === 1 && overflowCount > 0 ? <span className="extra-pill extra-pill-corner">+{overflowCount}</span> : null}</div>)}</div>;
}

function FilterGroup({ title, options, selected, onToggle }) {
  const normalizedOptions = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
  const shouldScroll = normalizedOptions.length > 10;
  return <section className="filter-group"><h4>{title}</h4><div className={["filter-options", shouldScroll ? "is-scrollable" : ""].join(" ").trim()}>{normalizedOptions.map((option) => <label key={option.value} className="filter-option"><input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} /><span title={option.label}>{option.label}</span></label>)}</div></section>;
}

function RegistrationForm({ onSwitchToLogin, clerkAppearance }) {
  const [form, setForm] = useState({ firstName: '', surname: '', designation: '' });
  const [showNameError, setShowNameError] = useState(false);

  const updateFormField = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      window.sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify({
        firstName: next.firstName.trim(),
        surname: next.surname.trim(),
        designation: next.designation.trim(),
      }));
      return next;
    });
    if (key === 'firstName' || key === 'surname') {
      setShowNameError(false);
    }
  };

  const handleSignUpClickCapture = (event) => {
    if (!form.firstName.trim() || !form.surname.trim()) {
      event.preventDefault();
      event.stopPropagation();
      setShowNameError(true);
    }
  };

  return (
    <div className="auth-custom-form">
      <div className="auth-form-grid single-column">
        <label>
          <span>First name</span>
          <input className="text-input" required value={form.firstName} onChange={(event) => updateFormField('firstName', event.target.value)} autoComplete="given-name" />
        </label>
        <label>
          <span>Last name</span>
          <input className="text-input" required value={form.surname} onChange={(event) => updateFormField('surname', event.target.value)} autoComplete="family-name" />
        </label>
        <label>
          <span>Designation</span>
          <input className="text-input" value={form.designation} onChange={(event) => updateFormField('designation', event.target.value)} autoComplete="organization-title" />
        </label>
      </div>
      {showNameError ? <div className="auth-error">Please complete first name and last name before creating the account.</div> : null}
      <div className="clerk-auth-shell" onClickCapture={handleSignUpClickCapture}>
        <SignUp
          routing="hash"
          signInUrl="#login"
          appearance={clerkAppearance}
          initialValues={{
            firstName: form.firstName.trim(),
            lastName: form.surname.trim(),
          }}
        />
      </div>
      <div className="auth-actions">
        <button className="ghost-button" type="button" onClick={onSwitchToLogin}>Back to login</button>
      </div>
    </div>
  );
}

function AuthShell({ authMode, setAuthMode }) {
  const clerkAppearance = {
    elements: {
      cardBox: 'clerk-cardbox',
      card: 'clerk-card',
      headerTitle: 'clerk-header-title',
      headerSubtitle: 'clerk-header-subtitle',
      socialButtonsBlockButton: 'clerk-social-button',
      socialButtonsBlockButtonText: 'clerk-social-button-text',
      formButtonPrimary: 'clerk-primary-button',
      footerActionLink: 'clerk-footer-link',
      formFieldInput: 'clerk-input',
      formFieldLabel: 'clerk-label',
    },
  };

  return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">SelfieBox Events Platform</div>
          <h1>{authMode === 'login' ? 'Sign in' : 'Create your account'}</h1>
          <div className="auth-tabs">
            <button className={authMode === 'login' ? 'is-active' : ''} type="button" onClick={() => setAuthMode('login')}>Login</button>
            <button className={authMode === 'register' ? 'is-active' : ''} type="button" onClick={() => setAuthMode('register')}>Register</button>
          </div>
          <div className="clerk-auth-shell">
            {authMode === 'login' ? <SignIn routing="hash" signUpUrl="#register" appearance={clerkAppearance} /> : <RegistrationForm onSwitchToLogin={() => setAuthMode('login')} clerkAppearance={clerkAppearance} />}
          </div>
        </div>
      </div>
    );
}

function LoadingShell() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">SelfieBox Events Platform</div>
        <h1>Loading your account</h1>
        <p>Please wait while you are being logged in.</p>
      </div>
    </div>
  );
}

function App() {
  const bookingToken = getBookingTokenFromPath(typeof window !== 'undefined' ? window.location.pathname : '/');
  const [authMode, setAuthMode] = useState('login');

  if (bookingToken) {
    return <BookingPage token={bookingToken} />;
  }

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

function BookingDrawerSummary({ booking }) {
  const formData = booking?.formData || {};
  const snapshots = Array.isArray(booking?.snapshots) ? booking.snapshots : [];
  const rows = [
    ['Product', formData.product],
    ['Booking Type', formData.customerType],
    ['Company Name', formData.companyName],
    ['Event Name', formData.eventName],
    ['Contact Person', formData.contactPerson],
    ['Cell', formData.cell],
    ['Email', formData.email],
    ['Date of Event', formData.eventDate],
    ['Region', formData.region],
    ['Address', formData.address],
    ['Point of Contact', formData.pointOfContactName],
    ['Point of Contact Number', formData.pointOfContactNumber],
    ['Setup Time', formData.setupTime],
    ['Event Start Time', formData.eventStartTime],
    ['Event Finish Time', formData.eventFinishTime],
    ['Optional Extras', Array.isArray(formData.optionalExtras) ? formData.optionalExtras.join(', ') : ''],
    ['Design Yourself', formData.designYourself],
    ['Notes / Special Instructions', formData.notes],
    ['Ts and Cs', formData.acceptedTerms ? 'Accepted' : 'Pending'],
  ];

  const visibleRows = rows.filter(([, value]) => String(value || '').trim());
  if (!visibleRows.length) {
    return <div className="empty-month">No booking details submitted yet.</div>;
  }

  return (
    <div className="booking-summary-grid">
      {visibleRows.map(([label, value]) => (
        <div className="booking-summary-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {snapshots.length ? <div className="booking-summary-row booking-summary-submissions"><span>Saved Forms</span><div className="booking-submission-list">{snapshots.map((snapshot) => <a key={snapshot.id} className="booking-submission-link" href={snapshot.url} target="_blank" rel="noreferrer">{`${new Date(snapshot.submittedAt).toLocaleString()}${snapshot.sourceIp ? ` · ${snapshot.sourceIp}` : ''}`}</a>)}</div></div> : null}
    </div>
  );
}

function ModalShell({ title, onClose, children, hideCloseButton = false, closeOnScrimClick = true }) {
  return <div className="modal-scrim" onClick={closeOnScrimClick ? onClose : undefined}><div className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3>{!hideCloseButton ? <button className="modal-close-x" type="button" onClick={onClose}>x</button> : null}</div>{children}</div></div>;
}

function ActivityEntry({ entry, title, eventName = '' }) {
  return <article className="activity-item" key={entry.id}><div className="activity-item-body"><div className="activity-item-meta"><time>{entry.date}</time><span>-</span><span>{entry.user || 'Unknown user'}</span></div><p title={title}>{eventName ? <><strong>{eventName}</strong>{entry.text ? <> {entry.text}</> : null}</> : entry.text}</p></div></article>;
}

function CustomSingleTag({ value, styles, width, placeholder = 'Select' }) {
  const label = value || placeholder;
  const resolved = value ? (styles[value] || { background: '#d6d6d6', color: '#223042' }) : { background: '#eef1f5', color: '#60708b' };
  const pillStyle = { ...resolved, width: '100%', minWidth: '100%', maxWidth: '100%', boxSizing: 'border-box' };
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

function getInitials(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'SB';
}

function abbreviateLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 7).toUpperCase();
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

function buildExportCell(column, event, lookups) {
  const value = formatExportValue(column.key, event, { ...lookups, column });
  const style = getExportCellStyle(column, event, lookups);
  return { value, style };
}

function getExportCellStyle(column, event, lookups) {
  if (column.key === 'hours') {
    return { align: 'Center' };
  }
  if (column.key === 'branch') {
    const firstBranch = (event.branch || [])[0];
    return firstBranch ? lookups.branchStyles[firstBranch] || null : null;
  }
  if (column.key === 'products') {
    const firstProduct = (event.products || [])[0];
    return firstProduct ? lookups.productStyles[firstProduct] || null : null;
  }
  if (column.key === 'status') {
    return lookups.statusStyles[event.status] || null;
  }
  if (['paymentStatus', 'accounts', 'vinyl', 'gsAi', 'imagesSent', 'snappic'].includes(column.key)) {
    return lookups.managedSingleStyles[column.key]?.[event[column.key]] || null;
  }
  if (column.key === 'attendants') {
    const firstAttendant = (event.attendants || [])[0];
    return firstAttendant ? lookups.attendantStyles[firstAttendant] || null : null;
  }
  if (column.isCustom) {
    const customValue = (event.customFields || {})[column.key];
    if (column.type === 'singleItem' && typeof customValue === 'string') {
      return lookups.customItemStyles[column.key]?.[customValue] || null;
    }
    if (column.type === 'multiItem' && Array.isArray(customValue) && customValue.length) {
      return lookups.customItemStyles[column.key]?.[customValue[0]] || null;
    }
  }
  return null;
}

function isPastEvent(event) {
  const value = String(event?.date || '').trim();
  if (!value) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const eventDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return eventDate < today;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed < today;
}

function orderColumnsAfterPayment(columns, savedOrder) {
  const paymentIndex = columns.findIndex((column) => column.key === 'accounts');
  if (paymentIndex === -1) {
    return columns;
  }

  const fixedColumns = columns.slice(0, paymentIndex + 1);
  const movableColumns = columns.slice(paymentIndex + 1);
  const movableByKey = new Map(movableColumns.map((column) => [column.key, column]));
  const ordered = [];

  (savedOrder || []).forEach((key) => {
    const column = movableByKey.get(key);
    if (column) {
      ordered.push(column);
      movableByKey.delete(key);
    }
  });

  return [...fixedColumns, ...ordered, ...movableColumns.filter((column) => movableByKey.has(column.key))];
}

function normalizeHexColor(value, fallback = 'FFFFFF') {
  const cleaned = String(value || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return fallback;
  }
  return cleaned.toUpperCase();
}

async function buildWorkbookXlsxBuffer({ sheets, columns }) {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SelfieBox Events Platform';
  workbook.created = new Date();

  sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    worksheet.columns = columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.max(10, Math.round(column.width / 7.2)),
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF26427B' }, name: 'Calibri', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1FF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6DEEB' } },
        left: { style: 'thin', color: { argb: 'FFD6DEEB' } },
        bottom: { style: 'thin', color: { argb: 'FFD6DEEB' } },
        right: { style: 'thin', color: { argb: 'FFD6DEEB' } },
      };
    });

    sheet.rows.forEach((row) => {
      const worksheetRow = worksheet.addRow(row.map((cell) => cell.value));
      worksheetRow.height = 20;
      row.forEach((cell, index) => {
        const worksheetCell = worksheetRow.getCell(index + 1);
        worksheetCell.alignment = {
          vertical: 'middle',
          horizontal: cell.style?.align?.toLowerCase() === 'center' ? 'center' : 'left',
          wrapText: true,
        };
        worksheetCell.border = {
          top: { style: 'thin', color: { argb: 'FFD6DEEB' } },
          left: { style: 'thin', color: { argb: 'FFD6DEEB' } },
          bottom: { style: 'thin', color: { argb: 'FFD6DEEB' } },
          right: { style: 'thin', color: { argb: 'FFD6DEEB' } },
        };
        if (cell.style?.background) {
          worksheetCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: `FF${normalizeHexColor(cell.style.background)}` },
          };
        }
        if (cell.style?.color) {
          worksheetCell.font = {
            color: { argb: `FF${normalizeHexColor(cell.style.color, '233142')}` },
            name: 'Calibri',
            size: 10,
            bold: true,
          };
        } else {
          worksheetCell.font = { name: 'Calibri', size: 10 };
        }
      });
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, sheet.rows.length + 1), column: columns.length },
    };
  });

  return workbook.xlsx.writeBuffer();
}

function downloadWorkbookFile(filename, contents) {
  const blob = new Blob([contents], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseCommissionHours(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/\u2013|\u2014/g, '-').toLowerCase();
  const numericMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/);
  if (numericMatch) {
    const parsed = Number(numericMatch[1]);
    return Number.isFinite(parsed) ? Math.max(0, Math.ceil(parsed)) : 0;
  }

  const timeRangeMatch = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (timeRangeMatch) {
    const startMinutes = Number(timeRangeMatch[1]) * 60 + Number(timeRangeMatch[2]);
    let endMinutes = Number(timeRangeMatch[3]) * 60 + Number(timeRangeMatch[4]);
    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60;
    }
    const durationHours = (endMinutes - startMinutes) / 60;
    return durationHours > 0 ? Math.ceil(durationHours) : 0;
  }

  return 0;
}

function calculateCommissionAmount(hoursPayable) {
  const hours = Number(hoursPayable) || 0;
  if (hours <= 0) return 0;
  if (hours <= 2) return 500;
  if (hours === 3) return 550;
  if (hours === 4) return 600;
  if (hours === 5) return 650;
  return 1000;
}

function getCommissionPeriodLabel(month, year, period) {
  const monthLabel = `${month} ${year}`;
  if (period === 'firstHalf') {
    return `1-15 ${monthLabel}`;
  }
  if (period === 'secondHalf') {
    return `16-end ${monthLabel}`;
  }
  return `All ${monthLabel}`;
}

async function exportCommissionPdf({ month, year, period, attendant, rows }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 44;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const colX = {
    event: left,
    date: 280,
    hours: 352,
    payable: 432,
    amount: 510,
  };
  let y = 56;

  const ensureSpace = (needed = 20) => {
    if (y + needed <= pageHeight - 70) {
      return;
    }
    doc.addPage();
    y = 56;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('SelfieBox commission sheet for:', left, y);
  y += 22;

  doc.setFontSize(12);
  doc.text(getCommissionPeriodLabel(month, year, period), left, y);
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.text(`Attendant: ${attendant || '-'}`, left, y);
  y += 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Event Name', colX.event, y);
  doc.text('Date', colX.date, y);
  doc.text('Hours', colX.hours, y);
  doc.text('Hours Payable', colX.payable, y);
  doc.text('Amount', colX.amount, y);
  y += 8;
  doc.setLineWidth(0.8);
  doc.line(left, y, pageWidth - left, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  rows.forEach((row) => {
    ensureSpace(28);
    doc.text(String(row.eventName || '-').slice(0, 32), colX.event, y);
    doc.text(formatDateDisplay(row.date || '') || '-', colX.date, y);
    doc.text(String(row.hours || '-').slice(0, 12), colX.hours, y);
    doc.text(String(row.hoursPayable ?? 0), colX.payable + 14, y, { align: 'right' });
    doc.text(String(row.amount ?? 0), colX.amount + 24, y, { align: 'right' });
    y += 18;
  });

  ensureSpace(90);
  y += 24;
  doc.line(left, y, left + 180, y);
  doc.line(left + 240, y, left + 360, y);
  y += 14;
  doc.setFontSize(10);
  doc.text('Signature', left, y);
  doc.text('Date', left + 240, y);

  doc.save(`selfiebox-commission-${year}-${month.toLowerCase()}-${String(attendant || 'sheet').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`);
}
export default App;








