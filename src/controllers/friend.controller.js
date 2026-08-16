import * as friendService from '../services/friend.service.js';

export async function searchUsers(req, res, next) {
  try {
    const users = await friendService.searchUsers(req.user.id, req.query.q);

    res.status(200).json({
      success: true,
      data: {
        users,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function sendFriendRequest(req, res, next) {
  try {
    const request = await friendService.sendFriendRequest(
      req.user.id,
      req.params.userId,
    );

    res.status(201).json({
      success: true,
      data: {
        request,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listIncomingRequests(req, res, next) {
  try {
    const requests = await friendService.listIncomingRequests(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        requests,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listOutgoingRequests(req, res, next) {
  try {
    const requests = await friendService.listOutgoingRequests(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        requests,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function acceptFriendRequest(req, res, next) {
  try {
    const friendship = await friendService.acceptFriendRequest(
      req.user.id,
      req.params.requestId,
    );

    res.status(200).json({
      success: true,
      data: {
        friendship,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteFriendRequest(req, res, next) {
  try {
    const result = await friendService.deleteFriendRequest(
      req.user.id,
      req.params.requestId,
    );

    res.status(200).json({
      success: true,
      data: {
        request: result,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listFriends(req, res, next) {
  try {
    const friends = await friendService.listFriends(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        friends,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function removeFriend(req, res, next) {
  try {
    const result = await friendService.removeFriend(
      req.user.id,
      req.params.friendId,
    );

    res.status(200).json({
      success: true,
      data: {
        friendship: result,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getFriendPublicKey(req, res, next) {
  try {
    const user = await friendService.getFriendPublicKey(
      req.user.id,
      req.params.friendId,
    );

    res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
}
