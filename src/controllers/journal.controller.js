import * as journalService from '../services/journal.service.js';

export async function createJournal(req, res, next) {
  try {
    const journal = await journalService.createJournal(req.user.id, req.body);

    res.status(201).json({
      success: true,
      data: {
        journal,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listJournals(req, res, next) {
  try {
    const journals = await journalService.listJournalsForUser(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        journals,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listSharedWithMe(req, res, next) {
  try {
    const journals = await journalService.listSharedWithMe(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        journals,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getJournal(req, res, next) {
  try {
    const journal = await journalService.getJournalForUser(
      req.user.id,
      req.params.journalId,
    );

    res.status(200).json({
      success: true,
      data: {
        journal,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateJournal(req, res, next) {
  try {
    const journal = await journalService.updateJournal(
      req.user.id,
      req.params.journalId,
      req.body,
    );

    res.status(200).json({
      success: true,
      data: {
        journal,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateJournalUnlockAt(req, res, next) {
  try {
    const journal = await journalService.updateJournalUnlockAt(
      req.user.id,
      req.params.journalId,
      req.body,
    );

    res.status(200).json({
      success: true,
      data: {
        journal,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteJournal(req, res, next) {
  try {
    const result = await journalService.deleteJournal(
      req.user.id,
      req.params.journalId,
    );

    res.status(200).json({
      success: true,
      data: {
        journal: result,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function shareJournal(req, res, next) {
  try {
    const share = await journalService.shareJournal(
      req.user.id,
      req.params.journalId,
      req.body,
    );

    res.status(201).json({
      success: true,
      data: {
        share,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeJournalShare(req, res, next) {
  try {
    const result = await journalService.revokeJournalShare(
      req.user.id,
      req.params.journalId,
      req.params.userId,
    );

    res.status(200).json({
      success: true,
      data: {
        share: result,
      },
    });
  } catch (error) {
    next(error);
  }
}
