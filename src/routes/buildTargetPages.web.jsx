/**
 * ════════════════════════════════════════════════
 * FILE: buildTargetPages.web.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lists every screen the normal browser build may open. Most screens remain
 *   deferred until someone visits them, preserving the existing small first
 *   download and stale-file recovery behavior.
 *
 * DEPENDS ON:
 *   Packages:  none directly
 *   Internal:  src/routes/lazyRetry.js, src/components/{Layout,SettingsLayout},
 *              src/pages/
 *   Data:      reads  → none directly
 *              writes → none directly
 *
 * NOTES / GOTCHAS:
 *   - Vite selects this file for ordinary web/PWA builds.
 *   - Login and the two browser layout shells stay eager, matching the prior App
 *     entry graph; every other screen keeps the prior lazy import boundary.
 * ════════════════════════════════════════════════
 */
import Layout from '@/components/Layout';
import SettingsLayout from '@/components/SettingsLayout';
import Login from '@/pages/Login';

import { lazyRetry } from './lazyRetry.js';

const Dashboard = lazyRetry(() => import('@/pages/Dashboard'));
const Conversations = lazyRetry(() => import('@/pages/Conversations'));
const Jobs = lazyRetry(() => import('@/pages/Jobs'));
const JobsClosed = lazyRetry(() => import('@/pages/JobsClosed'));
const JobPage = lazyRetry(() => import('@/pages/JobPage'));
const ClaimsList = lazyRetry(() => import('@/pages/ClaimsList'));
const ClaimPage = lazyRetry(() => import('@/pages/ClaimPage'));
const Production = lazyRetry(() => import('@/pages/Production'));
const Melds = lazyRetry(() => import('@/pages/Melds'));
const Leads = lazyRetry(() => import('@/pages/Leads'));
const Customers = lazyRetry(() => import('@/pages/Customers'));
const CustomerPage = lazyRetry(() => import('@/pages/CustomerPage'));
const Schedule = lazyRetry(() => import('@/pages/Schedule'));
const ScheduleTemplates = lazyRetry(() => import('@/pages/ScheduleTemplates'));
const TimeTracking = lazyRetry(() => import('@/pages/TimeTracking'));
const Marketing = lazyRetry(() => import('@/pages/Marketing'));
const SettingsHome = lazyRetry(() => import('@/pages/settings/SettingsHome'));
const ListsAndValues = lazyRetry(() => import('@/pages/settings/ListsAndValues'));
const Templates = lazyRetry(() => import('@/pages/settings/Templates'));
const TemplatesEditor = lazyRetry(() => import('@/pages/settings/TemplatesEditor'));
const Commissions = lazyRetry(() => import('@/pages/settings/Commissions'));
const MyAccount = lazyRetry(() => import('@/pages/settings/MyAccount'));
const NotificationsSettings = lazyRetry(() => import('@/pages/settings/Notifications'));
const Team = lazyRetry(() => import('@/pages/settings/Team'));
const Roles = lazyRetry(() => import('@/pages/settings/Roles'));
const PageAccess = lazyRetry(() => import('@/pages/settings/PageAccess'));
const NotificationDefaults = lazyRetry(() => import('@/pages/settings/NotificationDefaults'));
const NotificationPresentation = lazyRetry(() => import('@/pages/settings/NotificationPresentation'));
const SignPage = lazyRetry(() => import('@/pages/SignPage'));
const SetPassword = lazyRetry(() => import('@/pages/SetPassword'));
const Collections = lazyRetry(() => import('@/pages/Collections'));
const ClaimCollectionPage = lazyRetry(() => import('@/pages/ClaimCollectionPage'));
const DevTools = lazyRetry(() => import('@/pages/DevTools'));
const Status = lazyRetry(() => import('@/pages/Status'));
const PublicRoadmap = lazyRetry(() => import('@/pages/PublicRoadmap'));
const PrivacyPolicy = lazyRetry(() => import('@/pages/Legal')
  .then((module) => ({ default: module.PrivacyPolicy })));
const TermsOfService = lazyRetry(() => import('@/pages/Legal')
  .then((module) => ({ default: module.TermsOfService })));
const Support = lazyRetry(() => import('@/pages/Legal')
  .then((module) => ({ default: module.Support })));
const AdminFeedback = lazyRetry(() => import('@/pages/settings/FeedbackInbox'));
const Feedback = lazyRetry(() => import('@/pages/Feedback'));
const OOPPricing = lazyRetry(() => import('@/pages/OOPPricingConfigured'));
const OopPricingSettings = lazyRetry(() => import('@/pages/settings/OopPricingBuilder'));
const AdminDemoSheetBuilder = lazyRetry(() => import('@/pages/settings/ScopeSheets'));
const AdminIntegrations = lazyRetry(() => import('@/pages/settings/Integrations'));
const EncircleImport = lazyRetry(() => import('@/pages/EncircleImport'));
const Help = lazyRetry(() => import('@/pages/Help'));
const InvoiceEditor = lazyRetry(() => import('@/pages/InvoiceEditor'));
const EstimateEditor = lazyRetry(() => import('@/pages/EstimateEditor'));
const PaymentSettings = lazyRetry(() => import('@/pages/settings/Payments'));
const HomebuildingAnalysis = lazyRetry(() => import('@/pages/HomebuildingAnalysis'));
const NewBuildSimulator = lazyRetry(() => import('@/pages/NewBuildSimulator'));
const CrmLayout = lazyRetry(() => import('@/components/CrmLayout'));
const CrmRoadmap = lazyRetry(() => import('@/pages/crm/CrmRoadmap'));
const CrmOverview = lazyRetry(() => import('@/pages/crm/CrmOverview'));
const CrmLeads = lazyRetry(() => import('@/pages/crm/CrmLeads'));
const CrmCallLog = lazyRetry(() => import('@/pages/crm/CrmCallLog'));
const CrmTasks = lazyRetry(() => import('@/pages/crm/CrmTasks'));
const CrmAttribution = lazyRetry(() => import('@/pages/crm/CrmAttribution'));
const CrmReports = lazyRetry(() => import('@/pages/crm/CrmReports'));
const CrmCampaigns = lazyRetry(() => import('@/pages/crm/CrmCampaigns'));
const CrmIntegrations = lazyRetry(() => import('@/pages/crm/CrmIntegrations'));
const CrmSettings = lazyRetry(() => import('@/pages/crm/CrmSettings'));
const CrmContacts = lazyRetry(() => import('@/pages/crm/CrmContacts'));
const CrmConversations = lazyRetry(() => import('@/pages/crm/CrmConversations'));
const CrmSequences = lazyRetry(() => import('@/pages/crm/CrmSequences'));
const CrmAutomations = lazyRetry(() => import('@/pages/crm/CrmAutomations'));
const CrmForms = lazyRetry(() => import('@/pages/crm/CrmForms'));
const TechSettings = lazyRetry(() => import('@/pages/tech/TechSettings'));
const TechTasks = lazyRetry(() => import('@/pages/tech/TechTasks'));
const TechClaims = lazyRetry(() => import('@/pages/tech/TechClaims'));
const TechClaimDetail = lazyRetry(() => import('@/pages/tech/TechClaimDetail'));
const TechClaimAlbum = lazyRetry(() => import('@/pages/tech/TechClaimAlbum'));
const TechRoomDetail = lazyRetry(() => import('@/pages/tech/TechRoomDetail'));
const TechJobDetail = lazyRetry(() => import('@/pages/tech/TechJobDetail'));
const TechJobHub = lazyRetry(() => import('@/pages/tech/v2/TechJobHub'));
const TechJobAlbum = lazyRetry(() => import('@/pages/tech/TechJobAlbum'));
const TechJobDocuments = lazyRetry(() => import('@/pages/tech/TechJobDocuments'));
const TechAppointment = lazyRetry(() => import('@/pages/tech/TechAppointment'));
const TechNewCustomer = lazyRetry(() => import('@/pages/tech/TechNewCustomer'));
const TechNewJob = lazyRetry(() => import('@/pages/tech/TechNewJob'));
const TechNewAppointment = lazyRetry(() => import('@/pages/tech/TechNewAppointment'));
const TechNewEvent = lazyRetry(() => import('@/pages/tech/TechNewEvent'));
const TechEditAppointment = lazyRetry(() => import('@/pages/tech/TechEditAppointment'));
const TechFeedback = lazyRetry(() => import('@/pages/tech/TechFeedback'));
const TechMore = lazyRetry(() => import('@/pages/tech/TechMore'));
const TechHelp = lazyRetry(() => import('@/pages/tech/TechHelp'));
const TechOOPPricing = lazyRetry(() => import('@/pages/tech/TechOOPPricingConfigured'));
const TechDemoSheet = lazyRetry(() => import('@/pages/tech/TechDemoSheet'));
const AdminMobileRoutes = lazyRetry(() => import('@/pages/tech/admin/AdminMobileRoutes'));

export const IS_NATIVE_BUILD = false;

export default Object.freeze({
  AdminDemoSheetBuilder,
  AdminFeedback,
  AdminIntegrations,
  AdminMobileRoutes,
  ClaimCollectionPage,
  ClaimPage,
  ClaimsList,
  Collections,
  Commissions,
  Conversations,
  CrmAttribution,
  CrmAutomations,
  CrmCallLog,
  CrmCampaigns,
  CrmContacts,
  CrmConversations,
  CrmForms,
  CrmIntegrations,
  CrmLayout,
  CrmLeads,
  CrmOverview,
  CrmReports,
  CrmRoadmap,
  CrmSequences,
  CrmSettings,
  CrmTasks,
  CustomerPage,
  Customers,
  Dashboard,
  DevTools,
  EncircleImport,
  EstimateEditor,
  Feedback,
  Help,
  HomebuildingAnalysis,
  InvoiceEditor,
  JobPage,
  Jobs,
  JobsClosed,
  Layout,
  Leads,
  ListsAndValues,
  Login,
  Marketing,
  Melds,
  MyAccount,
  NewBuildSimulator,
  NotificationDefaults,
  NotificationPresentation,
  NotificationsSettings,
  OOPPricing,
  OopPricingSettings,
  PageAccess,
  PaymentSettings,
  PrivacyPolicy,
  Production,
  PublicRoadmap,
  Roles,
  Schedule,
  ScheduleTemplates,
  SetPassword,
  SettingsHome,
  SettingsLayout,
  SignPage,
  Status,
  Support,
  Team,
  TechAppointment,
  TechClaimAlbum,
  TechClaimDetail,
  TechClaims,
  TechDemoSheet,
  TechEditAppointment,
  TechFeedback,
  TechHelp,
  TechJobAlbum,
  TechJobDetail,
  TechJobDocuments,
  TechJobHub,
  TechMore,
  TechNewAppointment,
  TechNewCustomer,
  TechNewEvent,
  TechNewJob,
  TechOOPPricing,
  TechRoomDetail,
  TechSettings,
  TechTasks,
  Templates,
  TemplatesEditor,
  TermsOfService,
  TimeTracking,
});
