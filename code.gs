const CONFIG = {
  allowedDomain: "leightonpark.com",
  appName: "Tech Crew Sign Up",

  templateFiles: {
    layout: "1nFen5-cVTs_D2thMN_e3yTUQ_VT-unFpgBWaTQAnubk",
    inputList: "1QwwAaLCFOQIs9Z19rytSClSBMgpKkc9pLc3Vj8mWhnQ"
  },

  sheets: {
    events: "Events",
    roles: "Roles",
    eventRoles: "EventRoles",
    signups: "Signups",
    eventAvailability: "EventAvailability",
    users: "Users",
    admins: "Admins",
    trainingTags: "TrainingTags",
    activityLog: "ActivityLog",
    roleTemplates: "RoleTemplates",
    templateRoles: "TemplateRoles"
  }
};

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile("Index")
    .setTitle(CONFIG.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* =========================
   PUBLIC API
========================= */

function getInitialData() {
  const db = getDb_();
  const user = getCurrentUser_();

  if (!user.allowed) {
    return {
      ok: true,
      allowed: false,
      reason: user.reason || "Only @leightonpark.com accounts can access this site.",
      user: serializeUser_(user, null, false, [])
    };
  }

  ensureUserExists_(db, user);

  const freshDb = getDb_();
  const profile = getUserProfileFromDb_(freshDb, user.email);
  const isAdmin = isAdminFromDb_(freshDb, user.email);
  const trainingTags = getTrainingTagsForUserFromDb_(freshDb, user.email);

  return {
    ok: true,
    allowed: true,
    user: serializeUser_(user, profile, isAdmin, trainingTags),
    isAdmin,
    events: buildEvents_(freshDb, user.email, false),
    pastEvents: buildEvents_(freshDb, user.email, true),
    mySignups: buildMySignups_(freshDb, user.email),
    roles: buildRoleList_(freshDb),
    roleTemplates: buildRoleTemplates_(freshDb),
    admin: null
  };
}

function getAdminData() {
  requireAdmin_();
  return buildAdminData_(getDb_());
}

function saveMyProfile(profile) {
  const db = getDb_();
  const user = requireAllowedUser_();

  const name = String(profile && profile.name || "").trim();
  const yearGroup = normaliseYearGroup_(profile && profile.yearGroup);

  if (!name) throw new Error("Name is required.");
  if (!yearGroup) throw new Error("Year group is required.");

  updateRowByKey_(CONFIG.sheets.users, "Email", user.email, {
    Name: name,
    YearGroup: yearGroup,
    LastSeen: new Date()
  });

  logActivity_(user.email, "PROFILE_UPDATED", `${user.email} updated their profile`);
  return getInitialData();
}

function getEventDetails(eventId) {
  const db = getDb_();
  const user = requireAllowedUser_();

  const event = db.events.find(e => str_(e.EventID) === str_(eventId));
  if (!event) throw new Error("Event not found.");

  return buildEventDetails_(db, eventId, user.email);
}

function signUpForRole(eventId, eventRoleId, signupType, notes) {
  const db = getDb_();
  const user = requireAllowedUser_();
  const profile = getUserProfileFromDb_(db, user.email);

  if (!profile || !str_(profile.Name) || !str_(profile.YearGroup)) {
    throw new Error("Please complete your profile before signing up.");
  }

  const type = "Main";

  const details = buildEventDetails_(db, eventId, user.email);
  const role = details.rolesFlat.find(r => str_(r.EventRoleID) === str_(eventRoleId));

  if (!role) throw new Error("Role not found.");

  if (role.RequiresTrainingTag && !userHasTrainingTagFromDb_(db, user.email, role.RequiresTrainingTag)) {
    throw new Error("You need training for this role. Ask a teacher if this is a mistake.");
  }

  const duplicate = db.signups.find(s =>
    str_(s.Email).toLowerCase() === user.email.toLowerCase() &&
    str_(s.EventRoleID) === str_(eventRoleId) &&
    str_(s.Status).toLowerCase() === "active"
  );

  if (duplicate) throw new Error("You are already signed up for this role.");

  if (role.SpacesLeft <= 0) {
    throw new Error("This role is already full.");
  }

  clearEventAvailability_(db, eventId, user.email, user.email);

  appendObject_(CONFIG.sheets.signups, {
    SignupID: nextId_(db.signups, "S", "SignupID"),
    EventID: eventId,
    EventRoleID: eventRoleId,
    Email: user.email,
    Name: profile.Name,
    YearGroup: profile.YearGroup,
    SignupType: type,
    Status: "Active",
    Notes: notes || "",
    Timestamp: new Date()
  });

  logActivity_(user.email, "SIGNUP_CREATED", `${profile.Name || user.email} signed up for ${eventRoleId} on ${eventId}`);

  const updatedDb = getDb_();
  return buildEventDetails_(updatedDb, eventId, user.email);
}

function adminSignUpUserForRole(eventId, eventRoleId, email) {
  const admin = requireAdmin_();
  const db = getDb_();

  const cleanEmail = str_(email).trim().toLowerCase();

  if (!cleanEmail) {
    throw new Error("Email is required.");
  }

  if (!cleanEmail.endsWith("@" + CONFIG.allowedDomain)) {
    throw new Error("Only @" + CONFIG.allowedDomain + " users can be signed up.");
  }

  const profile = getUserProfileFromDb_(db, cleanEmail);

  if (!profile) {
    throw new Error("User not found. They need to open the site once first.");
  }

  if (!str_(profile.Name)) {
    throw new Error("This user has not completed their name yet.");
  }

  if (!str_(profile.YearGroup)) {
    throw new Error("This user has not completed their year group yet.");
  }

  const details = buildEventDetails_(db, eventId, cleanEmail);
  const role = details.rolesFlat.find(r => str_(r.EventRoleID) === str_(eventRoleId));

  if (!role) {
    throw new Error("Role not found.");
  }

  const duplicate = db.signups.find(s =>
    str_(s.Email).toLowerCase() === cleanEmail &&
    str_(s.EventRoleID) === str_(eventRoleId) &&
    str_(s.Status).toLowerCase() === "active"
  );

  if (duplicate) {
    throw new Error("This user is already signed up for this role.");
  }

  if (role.SpacesLeft <= 0) {
    throw new Error("This role is already full.");
  }

  clearEventAvailability_(db, eventId, cleanEmail, admin.email);

  appendObject_(CONFIG.sheets.signups, {
    SignupID: nextId_(db.signups, "S", "SignupID"),
    EventID: eventId,
    EventRoleID: eventRoleId,
    Email: cleanEmail,
    Name: profile.Name,
    YearGroup: profile.YearGroup,
    SignupType: "Main",
    Status: "Active",
    Notes: "Added by admin: " + admin.email,
    Timestamp: new Date()
  });

  // #email send admin-added signup notification here later

  logActivity_(
    admin.email,
    "SIGNUP_ADDED_BY_ADMIN",
    `${admin.email} added ${profile.Name || cleanEmail} to ${role.RoleName || eventRoleId} on ${eventId}`
  );

  return buildAdminData_(getDb_());
}

function cancelMySignup(signupId) {
  const user = requireAllowedUser_();
  const db = getDb_();

  const signup = db.signups.find(s =>
    str_(s.SignupID) === str_(signupId) &&
    str_(s.Email).toLowerCase() === user.email.toLowerCase() &&
    str_(s.Status).toLowerCase() === "active"
  );

  if (!signup) throw new Error("Signup not found.");

  updateRowByKey_(CONFIG.sheets.signups, "SignupID", signupId, {
    Status: "Removed",
    Notes: appendNote_(signup.Notes, "Cancelled by user")
  });

  logActivity_(user.email, "SIGNUP_CANCELLED", `${user.email} cancelled signup ${signupId}`);

  const updatedDb = getDb_();
  return buildEventDetails_(updatedDb, signup.EventID, user.email);
}


function setMyEventAvailability(eventId, status) {
  const db = getDb_();
  const user = requireAllowedUser_();
  const profile = getUserProfileFromDb_(db, user.email);

  if (!profile || !str_(profile.Name) || !str_(profile.YearGroup)) {
    throw new Error("Please complete your profile first.");
  }

  const cleanStatus = normaliseAvailabilityStatus_(status);
  if (!cleanStatus) throw new Error("Choose either performing or unavailable.");

  setEventAvailability_(db, eventId, user.email, cleanStatus, user.email);

  logActivity_(
    user.email,
    "EVENT_AVAILABILITY_SET",
    `${profile.Name || user.email} marked themselves as ${cleanStatus} for ${eventId}`
  );

  return buildEventDetails_(getDb_(), eventId, user.email);
}

function clearMyEventAvailability(eventId) {
  const db = getDb_();
  const user = requireAllowedUser_();

  clearEventAvailability_(db, eventId, user.email, user.email);

  logActivity_(user.email, "EVENT_AVAILABILITY_CLEARED", `${user.email} cleared availability for ${eventId}`);

  return buildEventDetails_(getDb_(), eventId, user.email);
}

function adminSetUserAvailability(eventId, email, status) {
  const admin = requireAdmin_();
  const db = getDb_();

  const cleanEmail = str_(email).trim().toLowerCase();
  if (!cleanEmail) throw new Error("Email is required.");

  const cleanStatus = normaliseAvailabilityStatus_(status);
  if (!cleanStatus) throw new Error("Choose either performing or unavailable.");

  setEventAvailability_(db, eventId, cleanEmail, cleanStatus, admin.email);

  logActivity_(
    admin.email,
    "EVENT_AVAILABILITY_SET_BY_ADMIN",
    `${admin.email} marked ${cleanEmail} as ${cleanStatus} for ${eventId}`
  );

  return buildAdminData_(getDb_());
}

function adminClearUserAvailability(eventId, email) {
  const admin = requireAdmin_();
  const db = getDb_();

  const cleanEmail = str_(email).trim().toLowerCase();
  if (!cleanEmail) throw new Error("Email is required.");

  clearEventAvailability_(db, eventId, cleanEmail, admin.email);

  logActivity_(
    admin.email,
    "EVENT_AVAILABILITY_CLEARED_BY_ADMIN",
    `${admin.email} cleared availability for ${cleanEmail} on ${eventId}`
  );

  return buildAdminData_(getDb_());
}

function setEventAvailability_(db, eventId, email, status, actorEmail) {
  const cleanEventId = str_(eventId);
  const cleanEmail = str_(email).trim().toLowerCase();
  const cleanStatus = normaliseAvailabilityStatus_(status);

  const event = db.events.find(e => str_(e.EventID) === cleanEventId);
  if (!event) throw new Error("Event not found.");

  const profile = getUserProfileFromDb_(db, cleanEmail);
  if (!profile) throw new Error("User not found. They need to open the site once first.");

  removeActiveSignupsForUserInEvent_(db, cleanEventId, cleanEmail, `Removed because user was marked as ${cleanStatus}`);

  const existing = db.eventAvailability.find(row =>
    str_(row.EventID) === cleanEventId &&
    str_(row.Email).toLowerCase() === cleanEmail &&
    isActiveAvailabilityStatus_(row.Status)
  );

  if (existing) {
    updateRowByKey_(CONFIG.sheets.eventAvailability, "AvailabilityID", existing.AvailabilityID, {
      Name: profile.Name || "",
      YearGroup: normaliseYearGroup_(profile.YearGroup),
      Status: cleanStatus,
      CreatedAt: new Date(),
      CreatedBy: actorEmail || ""
    });
    return;
  }

  appendObject_(CONFIG.sheets.eventAvailability, {
    AvailabilityID: nextId_(db.eventAvailability, "AV", "AvailabilityID"),
    EventID: cleanEventId,
    Email: cleanEmail,
    Name: profile.Name || "",
    YearGroup: normaliseYearGroup_(profile.YearGroup),
    Status: cleanStatus,
    CreatedAt: new Date(),
    CreatedBy: actorEmail || ""
  });
}

function clearEventAvailability_(db, eventId, email, actorEmail) {
  const cleanEventId = str_(eventId);
  const cleanEmail = str_(email).trim().toLowerCase();

  const activeRows = db.eventAvailability.filter(row =>
    str_(row.EventID) === cleanEventId &&
    str_(row.Email).toLowerCase() === cleanEmail &&
    isActiveAvailabilityStatus_(row.Status)
  );

  activeRows.forEach(row => {
    updateRowByKey_(CONFIG.sheets.eventAvailability, "AvailabilityID", row.AvailabilityID, {
      Status: "Removed",
      CreatedBy: actorEmail || row.CreatedBy || ""
    });
  });
}

function removeActiveSignupsForUserInEvent_(db, eventId, email, note) {
  db.signups
    .filter(signup =>
      str_(signup.EventID) === str_(eventId) &&
      str_(signup.Email).toLowerCase() === str_(email).toLowerCase() &&
      str_(signup.Status).toLowerCase() === "active"
    )
    .forEach(signup => {
      updateRowByKey_(CONFIG.sheets.signups, "SignupID", signup.SignupID, {
        Status: "Removed",
        Notes: appendNote_(signup.Notes, note || "Removed because user changed availability")
      });
    });
}

function activeAvailabilityForEvent_(db, eventId) {
  return db.eventAvailability.filter(row =>
    str_(row.EventID) === str_(eventId) &&
    isActiveAvailabilityStatus_(row.Status)
  );
}

function activeAvailabilityForUserEvent_(db, eventId, email) {
  return activeAvailabilityForEvent_(db, eventId).find(row =>
    str_(row.Email).toLowerCase() === str_(email).toLowerCase()
  ) || null;
}

function serializeAvailability_(row) {
  return {
    AvailabilityID: str_(row.AvailabilityID),
    EventID: str_(row.EventID),
    Email: str_(row.Email),
    Name: str_(row.Name),
    YearGroup: normaliseYearGroup_(row.YearGroup),
    Status: normaliseAvailabilityStatus_(row.Status),
    CreatedAt: formatDateTime_(row.CreatedAt),
    CreatedBy: str_(row.CreatedBy)
  };
}

function normaliseAvailabilityStatus_(status) {
  const raw = str_(status).trim().toLowerCase();

  if (raw === "performing" || raw === "performer" || raw === "attending, but performing") {
    return "Performing";
  }

  if (raw === "unavailable" || raw === "cannot attend" || raw === "i am unavailable") {
    return "Unavailable";
  }

  return "";
}

function isActiveAvailabilityStatus_(status) {
  const clean = normaliseAvailabilityStatus_(status);
  return clean === "Performing" || clean === "Unavailable";
}


function createEventWithRoles(payload) {
  const db = getDb_();
  const admin = requireAdmin_();

  const title = str_(payload.title).trim();
  if (!title) throw new Error("Event title is required.");
  if (!payload.date) throw new Error("Event date is required.");

  const eventId = nextId_(db.events, "EVT", "EventID");
  const selectedRoles = Array.isArray(payload.roles) ? payload.roles.filter(r => r.selected) : [];
  const resourceFiles = createEventResourceFiles_(payload);

  appendObject_(CONFIG.sheets.events, {
    EventID: eventId,
    Title: title,
    Tag: payload.tag || "Other",
    Date: payload.date,
    StartTime: payload.startTime || "",
    EndTime: payload.endTime || "",
    Notes: payload.notes || "",
    InputList: resourceFiles.inputList || "",
    LayoutLink: resourceFiles.layoutLink || "",
    IsPublished: payload.isPublished ? "TRUE" : "FALSE",
    IsPrivate: payload.isPrivate ? "TRUE" : "FALSE",
    Status: "Active",
    RolesSummary: payload.rolesSummary || selectedRoles.length + " roles"
  });

  const eventRolesSheet = getSheet_(CONFIG.sheets.eventRoles);
  const currentEventRoles = db.eventRoles.slice();

  selectedRoles.forEach(role => {
    const eventRoleId = nextId_(currentEventRoles, "ER", "EventRoleID");
    currentEventRoles.push({ EventRoleID: eventRoleId });

    appendObjectToSheet_(eventRolesSheet, {
      EventRoleID: eventRoleId,
      EventID: eventId,
      RoleID: role.roleId,
      MinPeople: toNumber_(role.minPeople, 0),
      MaxPeople: normaliseMaxPeopleForSheet_(role.maxPeople, 1),
      IsOptional: role.isOptional ? "TRUE" : "FALSE",
      Notes: role.notes || ""
    });
  });

  logActivity_(admin.email, "EVENT_CREATED", `${admin.email} created ${eventId}: ${title}`);
  return getInitialData();
}

function createEventResourceFiles_(payload) {
  const title = str_(payload.title).trim();
  const dateLabel = makeFileDateLabel_(payload.date);

  const result = {
    layoutLink: str_(payload.layoutLink),
    inputList: str_(payload.inputList)
  };

  if (payload.createLayoutFile) {
    result.layoutLink = copyTemplateFile_(
      CONFIG.templateFiles.layout,
      `${title} ${dateLabel} Floorplan`
    );
  }

  if (payload.createInputListFile) {
    result.inputList = copyTemplateFile_(
      CONFIG.templateFiles.inputList,
      `${title} ${dateLabel} Input List`
    );
  }

  return result;
}

function copyTemplateFile_(templateFileId, newName) {
  if (!templateFileId || templateFileId.includes("PASTE_")) {
    throw new Error("Missing template file ID in Code.gs.");
  }

  const templateFile = DriveApp.getFileById(templateFileId);
  const copiedFile = templateFile.makeCopy(newName);

  copiedFile.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

  return copiedFile.getUrl();
}

function makeFileDateLabel_(value) {
  if (!value) return "No Date";

  const date = parseDate_(value);

  if (!date) {
    return str_(value);
  }

  return Utilities.formatDate(date, Session.getScriptTimeZone(), "d MMM yyyy");
}

function updateEventDetails(eventId, payload) {
  const admin = requireAdmin_();
  const db = getDb_();

  const event = db.events.find(e => str_(e.EventID) === str_(eventId));
  if (!event) throw new Error("Event not found.");

  const title = str_(payload.title).trim();
  if (!title) throw new Error("Event title is required.");
  if (!payload.date) throw new Error("Event date is required.");

  updateRowByKey_(CONFIG.sheets.events, "EventID", eventId, {
    Title: title,
    Tag: payload.tag || "Other",
    Date: payload.date,
    StartTime: payload.startTime || "",
    EndTime: payload.endTime || "",
    Notes: payload.notes || "",
    InputList: payload.inputList || "",
    LayoutLink: payload.layoutLink || "",
    IsPublished: payload.isPublished ? "TRUE" : "FALSE",
    IsPrivate: payload.isPrivate ? "TRUE" : "FALSE",
    Status: payload.status || "Active",
    RolesSummary: payload.rolesSummary || ""
  });

  logActivity_(admin.email, "EVENT_UPDATED", `${admin.email} updated ${eventId}: ${title}`);
  return buildAdminData_(getDb_());
}

function updateEventRoles(eventId, selectedRoles) {
  const admin = requireAdmin_();
  const db = getDb_();

  const event = db.events.find(e => str_(e.EventID) === str_(eventId));
  if (!event) throw new Error("Event not found.");

  const eventRolesSheet = getSheet_(CONFIG.sheets.eventRoles);
  const values = eventRolesSheet.getDataRange().getValues();

  if (values.length < 1) {
    throw new Error("EventRoles sheet has no headers.");
  }

  const headers = values[0].map(h => str_(h).trim());

  const eventRoleIdIndex = headers.indexOf("EventRoleID");
  const eventIdIndex = headers.indexOf("EventID");
  const roleIdIndex = headers.indexOf("RoleID");
  const minPeopleIndex = headers.indexOf("MinPeople");
  const maxPeopleIndex = headers.indexOf("MaxPeople");
  const isOptionalIndex = headers.indexOf("IsOptional");
  const notesIndex = headers.indexOf("Notes");

  if (eventRoleIdIndex === -1 || eventIdIndex === -1 || roleIdIndex === -1) {
    throw new Error("EventRoles sheet must include EventRoleID, EventID and RoleID.");
  }

  const selected = (selectedRoles || []).filter(r => r.selected);

  const existingForEvent = db.eventRoles.filter(er => str_(er.EventID) === str_(eventId));

  const selectedRoleIds = selected.map(r => str_(r.roleId));

  // Delete event roles that are no longer selected, but only if nobody is actively signed up to them.
  for (let i = values.length - 1; i >= 1; i--) {
    const rowEventId = str_(values[i][eventIdIndex]);
    const rowRoleId = str_(values[i][roleIdIndex]);
    const rowEventRoleId = str_(values[i][eventRoleIdIndex]);

    if (rowEventId !== str_(eventId)) continue;
    if (selectedRoleIds.includes(rowRoleId)) continue;

    const activeSignupsForRemovedRole = db.signups.filter(signup =>
      str_(signup.EventRoleID) === rowEventRoleId &&
      str_(signup.Status).toLowerCase() === "active"
    );

    activeSignupsForRemovedRole.forEach(signup => {
      updateRowByKey_(CONFIG.sheets.signups, "SignupID", signup.SignupID, {
        Status: "Removed",
        Notes: appendNote_(signup.Notes, "Removed because this role was removed from the event")
      });
    });

    eventRolesSheet.deleteRow(i + 1);
  }

  const freshDb = getDb_();
  const currentEventRoles = freshDb.eventRoles.slice();

  selected.forEach(role => {
    const roleId = str_(role.roleId);

    const existingRole = existingForEvent.find(er => str_(er.RoleID) === roleId);

    if (existingRole) {
      updateRowByKey_(CONFIG.sheets.eventRoles, "EventRoleID", existingRole.EventRoleID, {
        MinPeople: toNumber_(role.minPeople, 0),
        MaxPeople: normaliseMaxPeopleForSheet_(role.maxPeople, 1),
        IsOptional: role.isOptional ? "TRUE" : "FALSE",
        Notes: role.notes || ""
      });

      return;
    }

    const eventRoleId = nextEventRoleId_(currentEventRoles, freshDb.signups);
    currentEventRoles.push({ EventRoleID: eventRoleId });

    appendObjectToSheet_(eventRolesSheet, {
      EventRoleID: eventRoleId,
      EventID: eventId,
      RoleID: roleId,
      MinPeople: toNumber_(role.minPeople, 0),
      MaxPeople: normaliseMaxPeopleForSheet_(role.maxPeople, 1),
      IsOptional: role.isOptional ? "TRUE" : "FALSE",
      Notes: role.notes || ""
    });
  });

  logActivity_(admin.email, "EVENT_ROLES_UPDATED", `${admin.email} updated roles for ${eventId}`);
  return buildAdminData_(getDb_());
}

function nextEventRoleId_(eventRoles, signups) {
  let max = 0;

  (eventRoles || []).forEach(row => {
    const raw = str_(row.EventRoleID);
    const match = raw.match(/(\d+)$/);

    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });

  (signups || []).forEach(row => {
    const raw = str_(row.EventRoleID);
    const match = raw.match(/(\d+)$/);

    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });

  return "ER" + String(max + 1).padStart(3, "0");
}

function removeSignupAsAdmin(signupId, reason) {
  const admin = requireAdmin_();
  const db = getDb_();

  const signup = db.signups.find(s => str_(s.SignupID) === str_(signupId));
  if (!signup) throw new Error("Signup not found.");

  const cleanReason = str_(reason).trim();
  if (!cleanReason) throw new Error("Please enter a reason.");

  updateRowByKey_(CONFIG.sheets.signups, "SignupID", signupId, {
    Status: "Removed",
    Notes: appendNote_(signup.Notes, `Removed by admin: ${cleanReason}`)
  });

  const event = db.events.find(e => str_(e.EventID) === str_(signup.EventID)) || {};
  const eventRole = db.eventRoles.find(er => str_(er.EventRoleID) === str_(signup.EventRoleID)) || {};
  const role = db.roles.find(r => str_(r.RoleID) === str_(eventRole.RoleID)) || {};

  // #email send removal notification to signup.Email here later

  logActivity_(
    admin.email,
    "SIGNUP_REMOVED_BY_ADMIN",
    `${admin.email} removed ${signup.Name || signup.Email} from ${event.Title || signup.EventID} / ${role.RoleName || signup.EventRoleID}. Reason: ${cleanReason}`
  );

  return buildAdminData_(getDb_());
}

function addTrainingTag(email, tag) {
  const admin = requireAdmin_();

  const cleanEmail = str_(email).trim().toLowerCase();
  const cleanTag = str_(tag).trim();

  if (!cleanEmail || !cleanTag) throw new Error("Email and tag are required.");

  const db = getDb_();

  const existing = db.trainingTags.some(t =>
    str_(t.Email).toLowerCase() === cleanEmail &&
    str_(t.Tag).toLowerCase() === cleanTag.toLowerCase()
  );

  if (!existing) {
    appendObject_(CONFIG.sheets.trainingTags, {
      Email: cleanEmail,
      Tag: cleanTag,
      AddedBy: admin.email,
      AddedAt: new Date()
    });
  }

  logActivity_(admin.email, "TRAINING_TAG_ADDED", `${admin.email} added ${cleanTag} to ${cleanEmail}`);
  return buildAdminData_(getDb_());
}

function updateUserYearGroup(email, yearGroup) {
  const admin = requireAdmin_();

  const cleanEmail = str_(email).trim().toLowerCase();
  const cleanYearGroup = normaliseYearGroup_(yearGroup);

  if (!cleanEmail) {
    throw new Error("Email is required.");
  }

  if (!cleanYearGroup) {
    throw new Error("Year group is required.");
  }

  updateRowByKey_(CONFIG.sheets.users, "Email", cleanEmail, {
    YearGroup: cleanYearGroup
  });

  logActivity_(
    admin.email,
    "USER_YEAR_GROUP_UPDATED",
    `${admin.email} changed ${cleanEmail} to ${cleanYearGroup}`
  );

  return buildAdminData_(getDb_());
}

function rollYearGroupsForward() {
  const admin = requireAdmin_();

  const sheet = getSheet_(CONFIG.sheets.users);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return {
      admin: buildAdminData_(getDb_()),
      changed: 0,
      archived: 0
    };
  }

  const headers = values[0].map(h => str_(h).trim());
  const yearIndex = headers.indexOf("YearGroup");

  if (yearIndex === -1) {
    throw new Error("Missing YearGroup column in Users sheet.");
  }

  let changed = 0;
  let archived = 0;

  for (let i = 1; i < values.length; i++) {
    const current = normaliseYearGroup_(values[i][yearIndex]);
    const next = nextYearGroup_(current);

    if (next !== current) {
      sheet.getRange(i + 1, yearIndex + 1).setValue(next);
      changed++;

      if (next === "Archived") {
        archived++;
      }
    }
  }

  logActivity_(
    admin.email,
    "YEAR_GROUPS_ROLLED_FORWARD",
    `${admin.email} rolled year groups forward. ${changed} user(s) changed, ${archived} archived.`
  );

  return {
    admin: buildAdminData_(getDb_()),
    changed,
    archived
  };
}

/* =========================
   BUILD RESPONSE DATA
========================= */

function buildEvents_(db, email, past) {
  const today = todayLocal_();

  return db.events
    .filter(event => bool_(event.IsPublished))
    .filter(event => str_(event.Status || "Active").toLowerCase() === "active")
    .filter(event => {
      const eventDate = parseDate_(event.Date);
      if (!eventDate) return false;

      return past ? eventDate < today : eventDate >= today;
    })
    .sort((a, b) => parseDate_(a.Date) - parseDate_(b.Date))
    .map(event => buildEventSummary_(db, event, email));
}

function buildEventSummary_(db, event, email) {
  const eventId = str_(event.EventID);
  const details = buildEventRoles_(db, eventId);

  const my = db.signups.filter(s =>
    str_(s.EventID) === eventId &&
    str_(s.Email).toLowerCase() === str_(email).toLowerCase() &&
    str_(s.Status).toLowerCase() === "active"
  );

  const myRoleNames = my.map(s => {
    const eventRole = db.eventRoles.find(er => str_(er.EventRoleID) === str_(s.EventRoleID)) || {};
    const role = db.roles.find(r => str_(r.RoleID) === str_(eventRole.RoleID)) || {};
    return str_(role.RoleName || eventRole.RoleID);
  });

  let missingPeople = 0;
  let openSpaces = 0;
  let hasUnlimitedOpenSpaces = false;

  const departmentNeedsMap = {};
  const departmentOpenSpacesMap = {};
  const departmentUnlimitedOpenMap = {};

  details.forEach(role => {
    const minPeople = toNumber_(role.MinPeople, 0);
    const unlimited = !!role.IsUnlimited;
    const maxPeople = unlimited ? null : toNumber_(role.MaxPeople, 0);
    const filled = toNumber_(role.Filled, 0);
    const department = str_(role.Department || "Other");

    const missingForRole = Math.max(minPeople - filled, 0);
    const openForRole = unlimited ? 0 : Math.max(maxPeople - filled, 0);

    missingPeople += missingForRole;
    openSpaces += openForRole;

    if (missingForRole > 0) {
      departmentNeedsMap[department] = (departmentNeedsMap[department] || 0) + missingForRole;
    }

    if (unlimited) {
      hasUnlimitedOpenSpaces = true;
      departmentUnlimitedOpenMap[department] = true;
    } else if (openForRole > 0) {
      departmentOpenSpacesMap[department] = (departmentOpenSpacesMap[department] || 0) + openForRole;
    }
  });

  const departmentNeeds = Object.keys(departmentNeedsMap)
    .map(department => ({
      Department: department,
      MissingPeople: departmentNeedsMap[department]
    }));

  const departmentOpenSpaces = Array.from(new Set([
    ...Object.keys(departmentOpenSpacesMap),
    ...Object.keys(departmentUnlimitedOpenMap)
  ])).map(department => ({
    Department: department,
    OpenSpaces: departmentUnlimitedOpenMap[department]
      ? "Unlimited"
      : departmentOpenSpacesMap[department]
  }));

  const myAvailability = activeAvailabilityForUserEvent_(db, eventId, email);

  return {
    EventID: eventId,
    Title: str_(event.Title),
    Tag: str_(event.Tag || "Event"),
    Date: formatDate_(event.Date),
    DateISO: formatDateISO_(event.Date),
    DateParts: dateParts_(event.Date),
    StartTime: formatTime_(event.StartTime),
    EndTime: formatTime_(event.EndTime),
    Notes: str_(event.Notes),
    InputList: str_(event.InputList),
    LayoutLink: str_(event.LayoutLink),
    IsPrivate: bool_(event.IsPrivate),
    Status: str_(event.Status || "Active"),
    RolesSummary: str_(event.RolesSummary),
    MissingCount: missingPeople,
    MissingPeople: missingPeople,
    OpenSpaces: openSpaces,
    HasUnlimitedOpenSpaces: hasUnlimitedOpenSpaces,
    DepartmentNeeds: departmentNeeds,
    DepartmentOpenSpaces: departmentOpenSpaces,
    SignedUp: my.length > 0,
    MyRoles: myRoleNames,
    MyAvailability: myAvailability ? serializeAvailability_(myAvailability) : null,
    RoleCount: details.length
  };
}

function buildEventDetails_(db, eventId, email) {
  const event = db.events.find(e => str_(e.EventID) === str_(eventId));
  if (!event) throw new Error("Event not found.");

  const rolesFlat = buildEventRoles_(db, eventId);
  const groupedRoles = groupByArray_(rolesFlat, "Department");

  const mySignups = db.signups
    .filter(s =>
      str_(s.EventID) === str_(eventId) &&
      str_(s.Email).toLowerCase() === str_(email).toLowerCase() &&
      str_(s.Status).toLowerCase() === "active"
    )
    .map(serializeSignup_);

  return {
    event: buildEventSummary_(db, event, email),
    roles: groupedRoles,
    rolesFlat,
    mySignups,
    availability: activeAvailabilityForEvent_(db, eventId).map(serializeAvailability_)
  };
}

function buildEventRoles_(db, eventId) {
  const activeMainSignups = db.signups.filter(s =>
    str_(s.EventID) === str_(eventId) &&
    str_(s.Status).toLowerCase() === "active" &&
    str_(s.SignupType || "Main").toLowerCase() === "main"
  );

  const allActiveSignups = db.signups.filter(s =>
    str_(s.EventID) === str_(eventId) &&
    str_(s.Status).toLowerCase() === "active"
  );

  return db.eventRoles
    .filter(er => str_(er.EventID) === str_(eventId))
    .map(er => {
      const role = db.roles.find(r => str_(r.RoleID) === str_(er.RoleID)) || {};
      const main = activeMainSignups.filter(s => str_(s.EventRoleID) === str_(er.EventRoleID));
      const all = allActiveSignups.filter(s => str_(s.EventRoleID) === str_(er.EventRoleID));

      const unlimited = isUnlimitedMax_(er.MaxPeople);
      const max = unlimited ? null : Math.max(toNumber_(er.MaxPeople, 1), 1);
      const min = toNumber_(er.MinPeople, 0);

      return {
        EventRoleID: str_(er.EventRoleID),
        EventID: str_(er.EventID),
        RoleID: str_(er.RoleID),
        Department: str_(role.Department || "Other"),
        RoleName: str_(role.RoleName || er.RoleID),
        RequiresTrainingTag: str_(role.RequiresTrainingTag),
        MinPeople: min,
        MaxPeople: unlimited ? "U" : max,
        MaxPeopleNumber: max,
        IsUnlimited: unlimited,
        IsOptional: bool_(er.IsOptional) || min === 0,
        Notes: str_(er.Notes),
        Filled: main.length,
        SpacesLeft: unlimited ? 999999 : Math.max(max - main.length, 0),
        Signups: all.map(serializeSignup_)
      };
    });
}

function buildMySignups_(db, email) {
  return db.signups
    .filter(s => {
      const event = db.events.find(e => str_(e.EventID) === str_(s.EventID));

      return (
        str_(s.Email).toLowerCase() === str_(email).toLowerCase() &&
        str_(s.Status).toLowerCase() === "active" &&
        event &&
        bool_(event.IsPublished) &&
        str_(event.Status || "Active").toLowerCase() === "active"
      );
    })
    .map(s => {
      const event = db.events.find(e => str_(e.EventID) === str_(s.EventID)) || {};
      const eventRole = db.eventRoles.find(er => str_(er.EventRoleID) === str_(s.EventRoleID)) || {};
      const role = db.roles.find(r => str_(r.RoleID) === str_(eventRole.RoleID)) || {};

      return {
        SignupID: str_(s.SignupID),
        EventID: str_(s.EventID),
        EventRoleID: str_(s.EventRoleID),
        EventTitle: str_(event.Title),
        Date: formatDate_(event.Date),
        DateISO: formatDateISO_(event.Date),
        StartTime: formatTime_(event.StartTime),
        EndTime: formatTime_(event.EndTime),
        RoleName: str_(role.RoleName || eventRole.RoleID),
        SignupType: "Main",
        Status: str_(s.Status),
        Notes: str_(s.Notes)
      };
    })
    .sort((a, b) => str_(a.DateISO).localeCompare(str_(b.DateISO)));
}

function buildRoleList_(db) {
  return db.roles.map(r => ({
    RoleID: str_(r.RoleID),
    Department: str_(r.Department || "Other"),
    RoleName: str_(r.RoleName),
    RequiresTrainingTag: str_(r.RequiresTrainingTag),
    Notes: str_(r.Notes || r.Description)
  }));
}

function buildRoleTemplates_(db) {
  return db.roleTemplates
    .filter(template => bool_(template.Active))
    .map(template => {
      const templateId = str_(template.TemplateID);

      const roles = db.templateRoles
        .filter(row => str_(row.TemplateID) === templateId)
        .map(row => ({
          TemplateRoleID: str_(row.TemplateRoleID),
          TemplateID: templateId,
          RoleID: str_(row.RoleID),
          MinPeople: toNumber_(row.MinPeople, 0),
          MaxPeople: normaliseMaxPeopleForSheet_(row.MaxPeople, 1),
          IsOptional: bool_(row.IsOptional),
          Notes: str_(row.Notes)
        }));

      return {
        TemplateID: templateId,
        TemplateName: str_(template.TemplateName),
        Description: str_(template.Description),
        Roles: roles
      };
    });
}

function buildAdminData_(db) {
  return {
    events: db.events.map(e => ({
      EventID: str_(e.EventID),
      Title: str_(e.Title),
      Tag: str_(e.Tag),
      Date: formatDate_(e.Date),
      DateISO: formatDateISO_(e.Date),
      DateParts: dateParts_(e.Date),
      StartTime: formatTime_(e.StartTime),
      EndTime: formatTime_(e.EndTime),
      Notes: str_(e.Notes),
      InputList: str_(e.InputList),
      LayoutLink: str_(e.LayoutLink),
      Status: str_(e.Status || "Active"),
      IsPublished: bool_(e.IsPublished),
      IsPrivate: bool_(e.IsPrivate),
      RolesSummary: str_(e.RolesSummary),
      MissingCount: buildEventRoles_(db, e.EventID).filter(r => r.Filled < r.MinPeople).length
    })).sort((a, b) => str_(a.DateISO).localeCompare(str_(b.DateISO))),

    roles: buildRoleList_(db),
    roleTemplates: buildRoleTemplates_(db),

    eventRoles: db.eventRoles.map(er => ({
      EventRoleID: str_(er.EventRoleID),
      EventID: str_(er.EventID),
      RoleID: str_(er.RoleID),
      MinPeople: toNumber_(er.MinPeople, 0),
      MaxPeople: isUnlimitedMax_(er.MaxPeople) ? "U" : toNumber_(er.MaxPeople, 1),
      IsOptional: bool_(er.IsOptional),
      Notes: str_(er.Notes)
    })),

    staffing: db.events.map(e => ({
      event: {
        EventID: str_(e.EventID),
        Title: str_(e.Title),
        Tag: str_(e.Tag),
        Date: formatDate_(e.Date),
        DateISO: formatDateISO_(e.Date),
        DateParts: dateParts_(e.Date),
        StartTime: formatTime_(e.StartTime),
        EndTime: formatTime_(e.EndTime),
        Status: str_(e.Status || "Active"),
        IsPublished: bool_(e.IsPublished)
      },
      roles: groupByArray_(buildEventRoles_(db, e.EventID), "Department"),
      rolesFlat: buildEventRoles_(db, e.EventID),
      missingRoles: buildEventRoles_(db, e.EventID).filter(r => r.Filled < r.MinPeople),
      availability: activeAvailabilityForEvent_(db, e.EventID).map(serializeAvailability_)
    })).sort((a, b) => str_(a.event.DateISO).localeCompare(str_(b.event.DateISO))),

    users: db.users.map(u => ({
      Email: str_(u.Email),
      Name: str_(u.Name),
      YearGroup: normaliseYearGroup_(u.YearGroup),
      IsAdmin: bool_(u.IsAdmin) || isAdminFromDb_(db, u.Email),
      LastSeen: formatDateTime_(u.LastSeen),
      TrainingTags: getTrainingTagsForUserFromDb_(db, u.Email)
    })),

    signups: db.signups.map(serializeSignup_),

    activity: db.activityLog.slice(-30).reverse().map(a => ({
      LogID: str_(a.LogID),
      Email: str_(a.Email),
      Action: str_(a.Action),
      Details: str_(a.Details),
      Timestamp: formatDateTime_(a.Timestamp)
    }))
  };
}

/* =========================
   AUTH / USER
========================= */

function getCurrentUser_() {
  const email = str_(Session.getActiveUser().getEmail()).toLowerCase();

  if (!email) {
    return {
      email: "",
      allowed: false,
      reason: "You must be signed in with your school Google account."
    };
  }

  const domain = email.split("@")[1] || "";

  return {
    email,
    domain,
    allowed: domain === CONFIG.allowedDomain
  };
}

function requireAllowedUser_() {
  const user = getCurrentUser_();

  if (!user.allowed) {
    throw new Error("Not allowed. Please use your Leighton Park account.");
  }

  return user;
}

function requireAdmin_() {
  const user = requireAllowedUser_();
  const db = getDb_();

  if (!isAdminFromDb_(db, user.email)) {
    throw new Error("Admin access required.");
  }

  return user;
}

function ensureUserExists_(db, user) {
  const existing = getUserProfileFromDb_(db, user.email);

  if (existing) {
    updateRowByKey_(CONFIG.sheets.users, "Email", user.email, {
      LastSeen: new Date()
    });
    return;
  }

  appendObject_(CONFIG.sheets.users, {
    Email: user.email,
    Name: "",
    YearGroup: "",
    IsAdmin: isAdminFromDb_(db, user.email) ? "TRUE" : "FALSE",
    CreatedAt: new Date(),
    LastSeen: new Date()
  });
}

function getUserProfileFromDb_(db, email) {
  return db.users.find(u => str_(u.Email).toLowerCase() === str_(email).toLowerCase());
}

function isAdminFromDb_(db, email) {
  return db.admins.some(a =>
    str_(a.Email).toLowerCase() === str_(email).toLowerCase() &&
    bool_(a.Active)
  );
}

function userHasTrainingTagFromDb_(db, email, tag) {
  if (!tag) return true;

  return db.trainingTags.some(t =>
    str_(t.Email).toLowerCase() === str_(email).toLowerCase() &&
    str_(t.Tag).toLowerCase() === str_(tag).toLowerCase()
  );
}

function getTrainingTagsForUserFromDb_(db, email) {
  return db.trainingTags
    .filter(t => str_(t.Email).toLowerCase() === str_(email).toLowerCase())
    .map(t => str_(t.Tag))
    .filter(Boolean);
}

/* =========================
   SHEET HELPERS
========================= */

function getDb_() {
  return {
    events: getRows_(getSheet_(CONFIG.sheets.events)),
    roles: getRows_(getSheet_(CONFIG.sheets.roles)),
    eventRoles: getRows_(getSheet_(CONFIG.sheets.eventRoles)),
    signups: getRows_(getSheet_(CONFIG.sheets.signups)),
    eventAvailability: getRows_(getOrCreateSheet_(CONFIG.sheets.eventAvailability, ["AvailabilityID", "EventID", "Email", "Name", "YearGroup", "Status", "CreatedAt", "CreatedBy"])),
    users: getRows_(getSheet_(CONFIG.sheets.users)),
    admins: getRows_(getSheet_(CONFIG.sheets.admins)),
    trainingTags: getRows_(getSheet_(CONFIG.sheets.trainingTags)),
    activityLog: getRows_(getSheet_(CONFIG.sheets.activityLog)),
    roleTemplates: getRows_(getSheet_(CONFIG.sheets.roleTemplates)),
    templateRoles: getRows_(getSheet_(CONFIG.sheets.templateRoles))
  };
}

function getOrCreateSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() < 1 && Array.isArray(headers) && headers.length) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);

  if (!sheet) {
    throw new Error(`Missing sheet: ${name}`);
  }

  return sheet;
}

function getHeaders_(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => str_(h).trim());
}

function getRows_(sheet) {
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  const headers = values[0].map(h => str_(h).trim());

  return values.slice(1)
    .filter(row => row.some(cell => cell !== ""))
    .map(row => {
      const object = {};
      headers.forEach((header, index) => object[header] = row[index]);
      return object;
    });
}

function appendObject_(sheetName, object) {
  appendObjectToSheet_(getSheet_(sheetName), object);
}

function appendObjectToSheet_(sheet, object) {
  const headers = getHeaders_(sheet);
  const row = headers.map(header => object[header] !== undefined ? object[header] : "");
  sheet.appendRow(row);
}

function updateRowByKey_(sheetName, keyHeader, keyValue, updates) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 1) {
    throw new Error(`Sheet ${sheetName} has no headers.`);
  }

  const headers = values[0].map(h => str_(h).trim());
  const keyIndex = headers.indexOf(keyHeader);

  if (keyIndex === -1) {
    throw new Error(`Missing key header: ${keyHeader}`);
  }

  for (let i = 1; i < values.length; i++) {
    if (str_(values[i][keyIndex]).toLowerCase() === str_(keyValue).toLowerCase()) {
      Object.keys(updates).forEach(updateKey => {
        const columnIndex = headers.indexOf(updateKey);

        if (columnIndex !== -1) {
          sheet.getRange(i + 1, columnIndex + 1).setValue(updates[updateKey]);
        }
      });

      return;
    }
  }

  throw new Error(`Could not find row with ${keyHeader}: ${keyValue}`);
}

function nextId_(rows, prefix, key) {
  let max = 0;

  rows.forEach(row => {
    const raw = str_(row[key]);
    const match = raw.match(/(\d+)$/);

    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });

  return prefix + String(max + 1).padStart(3, "0");
}

/* =========================
   SERIALIZATION / UTILS
========================= */

function serializeUser_(user, profile, isAdmin, trainingTags) {
  return {
    email: str_(user.email),
    domain: str_(user.domain),
    allowed: !!user.allowed,
    name: str_(profile && profile.Name),
    yearGroup: normaliseYearGroup_(profile && profile.YearGroup),
    isAdmin: !!isAdmin,
    trainingTags: trainingTags || [],
    profileComplete: !!(profile && str_(profile.Name) && str_(profile.YearGroup))
  };
}

function serializeSignup_(s) {
  return {
    SignupID: str_(s.SignupID),
    EventID: str_(s.EventID),
    EventRoleID: str_(s.EventRoleID),
    Email: str_(s.Email),
    Name: str_(s.Name),
    YearGroup: str_(s.YearGroup),
    SignupType: "Main",
    Status: str_(s.Status),
    Notes: str_(s.Notes),
    Timestamp: formatDateTime_(s.Timestamp)
  };
}

function groupByArray_(list, key) {
  const map = {};

  list.forEach(item => {
    const group = item[key] || "Other";

    if (!map[group]) {
      map[group] = [];
    }

    map[group].push(item);
  });

  return Object.keys(map).map(name => ({
    name,
    roles: map[name]
  }));
}

function logActivity_(email, action, details) {
  try {
    const db = getDb_();

    appendObject_(CONFIG.sheets.activityLog, {
      LogID: nextId_(db.activityLog, "LOG", "LogID"),
      Email: email,
      Action: action,
      Details: details,
      Timestamp: new Date()
    });
  } catch (err) {
    // Logging should not block the main action.
  }
}


function normaliseYearGroup_(value) {
  const raw = str_(value).trim();

  if (!raw) return "";
  if (raw.toLowerCase() === "n/a") return "N/A";
  if (raw.toLowerCase() === "na") return "N/A";

  if (raw.toLowerCase() === "teacher") return "Staff";
  if (raw.toLowerCase() === "staff") return "Staff";
  if (raw.toLowerCase() === "technician") return "Staff";
  if (raw.toLowerCase() === "tech") return "Staff";
  if (raw.toLowerCase() === "support staff") return "Staff";
  if (raw.toLowerCase() === "admin") return "Staff";

  if (raw.toLowerCase() === "archived") return "Archived";

  const match = raw.match(/(\d+)/);

  if (match) {
    const year = Number(match[1]);

    if (year >= 7 && year <= 13) {
      return `Year ${year}`;
    }
  }

  return raw;
}

function nextYearGroup_(yearGroup) {
  const current = normaliseYearGroup_(yearGroup);

  if (current === "N/A") return "N/A";
  if (current === "Staff") return "Staff";
  if (current === "Archived") return "Archived";

  const match = current.match(/Year\s*(\d+)/i);

  if (!match) return current;

  const year = Number(match[1]);

  if (year >= 7 && year <= 12) {
    return `Year ${year + 1}`;
  }

  if (year === 13) {
    return "Archived";
  }

  return current;
}

function appendNote_(oldNote, newNote) {
  const oldText = str_(oldNote).trim();
  const newText = str_(newNote).trim();

  if (!oldText) return newText;
  if (!newText) return oldText;

  return `${oldText} | ${newText}`;
}

function str_(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDateTime_(value);
  return String(value);
}

function bool_(value) {
  if (value === true) return true;
  return ["true", "yes", "1", "active"].includes(str_(value).trim().toLowerCase());
}

function toNumber_(value, fallback) {
  const n = Number(value);
  return isNaN(n) ? fallback : n;
}

function isUnlimitedMax_(value) {
  const raw = str_(value).trim().toLowerCase();
  return raw === "u" || raw === "unlimited" || raw === "∞" || raw === "inf" || raw === "infinite";
}

function normaliseMaxPeopleForSheet_(value, fallback) {
  if (isUnlimitedMax_(value)) return "U";

  const number = toNumber_(value, fallback || 1);
  return Math.max(Math.floor(number), 1);
}

function todayLocal_() {
  return startOfDay_(new Date());
}

function parseDate_(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return startOfDay_(new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    ));
  }

  const raw = str_(value).trim();

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return startOfDay_(new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3])
    ));
  }

  const ukMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    return startOfDay_(new Date(
      Number(ukMatch[3]),
      Number(ukMatch[2]) - 1,
      Number(ukMatch[1])
    ));
  }

  const date = new Date(raw);

  if (isNaN(date.getTime())) return null;

  return startOfDay_(new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ));
}

function startOfDay_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate_(value) {
  if (!value) return "";

  const date = parseDate_(value);

  if (!date) return str_(value);

  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEE d MMM yyyy");
}

function formatDateISO_(value) {
  if (!value) return "";

  const date = parseDate_(value);

  if (!date) return str_(value);

  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function dateParts_(value) {
  const date = parseDate_(value);

  if (!date) {
    return {
      day: "",
      mon: "",
      full: str_(value)
    };
  }

  return {
    day: Utilities.formatDate(date, Session.getScriptTimeZone(), "d"),
    mon: Utilities.formatDate(date, Session.getScriptTimeZone(), "MMM"),
    full: Utilities.formatDate(date, Session.getScriptTimeZone(), "EEE d MMM yyyy")
  };
}

function formatTime_(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }

  return str_(value);
}

function formatDateTime_(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }

  return str_(value);
}
